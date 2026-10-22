from pathlib import PurePath

from rest_framework import serializers

from apps.empresas.campos import RelacionDeEmpresa
from apps.organizacion.models import Cargo, UnidadOrganizacional

from .models import Material

TAMANO_MAXIMO = 50 * 1024 * 1024
#: Lo que se puede subir como archivo del material, con su firma (los
#: primeros bytes): un PDF o una presentación de PowerPoint.
ARCHIVOS = {
    ".pdf": ("application/pdf", [b"%PDF-"]),
    ".pptx": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [b"PK\x03\x04"],
    ),
    ".ppt": ("application/vnd.ms-powerpoint", [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"]),
}


def formatos(material) -> list[str]:
    """Lo que trae el material: «Texto», «PDF», «Presentación», «Video»."""
    lista = []
    if (material.contenido or "").strip():
        lista.append("Texto")
    if material.archivo:
        lista.append("PDF" if material.archivo_tipo == "application/pdf" else "Presentación")
    if material.url:
        lista.append("Video")
    return lista


class MaterialSerializer(serializers.ModelSerializer):
    """Un material: su alcance (empresa, área o cargo), su contenido según el
    tipo, y su nota mínima e intentos."""

    unidad = RelacionDeEmpresa(UnidadOrganizacional, required=False, allow_null=True)
    cargo = RelacionDeEmpresa(Cargo, required=False, allow_null=True)
    archivo = serializers.FileField(required=False, write_only=True)
    quitar_archivo = serializers.BooleanField(required=False, default=False, write_only=True)
    #: Explícito: en un envío con archivo, un booleano ausente se leería como falso.
    activo = serializers.BooleanField(default=True)
    formatos = serializers.SerializerMethodField()
    archivo_es_pdf = serializers.SerializerMethodField()
    nota_minima = serializers.IntegerField(min_value=1, max_value=100, default=70)
    intentos_max = serializers.IntegerField(min_value=1, max_value=10, default=3)
    #: Minutos; vacío, sin límite.
    tiempo_limite = serializers.IntegerField(
        min_value=1, max_value=600, required=False, allow_null=True
    )
    tiene_archivo = serializers.SerializerMethodField()
    preguntas = serializers.SerializerMethodField()
    de = serializers.SerializerMethodField()
    alcance_display = serializers.CharField(source="get_alcance_display", read_only=True)

    class Meta:
        model = Material
        fields = [
            "id",
            "titulo",
            "descripcion",
            "alcance",
            "alcance_display",
            "unidad",
            "cargo",
            "de",
            "formatos",
            "archivo",
            "quitar_archivo",
            "archivo_nombre",
            "archivo_es_pdf",
            "tiene_archivo",
            "url",
            "contenido",
            "nota_minima",
            "intentos_max",
            "tiempo_limite",
            "orden",
            "activo",
            "preguntas",
        ]
        read_only_fields = ["archivo_nombre"]

    def get_tiene_archivo(self, material) -> bool:
        return bool(material.archivo)

    def get_formatos(self, material) -> list[str]:
        return formatos(material)

    def get_archivo_es_pdf(self, material) -> bool:
        return material.archivo_tipo == "application/pdf"

    def get_preguntas(self, material) -> int:
        return material.preguntas.count()

    def get_de(self, material) -> str:
        if material.alcance == Material.Alcance.UNIDAD and material.unidad_id:
            return material.unidad.nombre
        if material.alcance == Material.Alcance.CARGO and material.cargo_id:
            return material.cargo.nombre
        return ""

    def validate_archivo(self, archivo):
        if archivo.size > TAMANO_MAXIMO:
            raise serializers.ValidationError("El archivo pesa más de 50 MB.")
        extension = PurePath(archivo.name).suffix.lower()
        if extension not in ARCHIVOS:
            raise serializers.ValidationError("Suba un PDF o una presentación (.ppt o .pptx).")
        tipo, firmas = ARCHIVOS[extension]
        cabecera = archivo.read(8)
        archivo.seek(0)
        if not any(cabecera.startswith(f) for f in firmas):
            raise serializers.ValidationError(
                f"El contenido no corresponde a un {extension}. "
                "Verifique que no se haya renombrado la extensión."
            )
        self._tipo_archivo = tipo
        return archivo

    def validate(self, datos):
        def valor(campo):
            return datos.get(campo, getattr(self.instance, campo, None))

        alcance = valor("alcance")
        if alcance == Material.Alcance.UNIDAD and not valor("unidad"):
            raise serializers.ValidationError({"unidad": "Elija el área."})
        if alcance == Material.Alcance.CARGO and not valor("cargo"):
            raise serializers.ValidationError({"cargo": "Elija el cargo."})
        if alcance != Material.Alcance.UNIDAD:
            datos["unidad"] = None
        if alcance != Material.Alcance.CARGO:
            datos["cargo"] = None
        # Texto, archivo y video se combinan; basta con uno.
        conserva_archivo = bool(self.instance and self.instance.archivo) and not datos.get(
            "quitar_archivo"
        )
        if not (
            (valor("contenido") or "").strip()
            or valor("url")
            or datos.get("archivo")
            or conserva_archivo
        ):
            raise serializers.ValidationError(
                {"contenido": "Agregue al menos un contenido: texto, un archivo o un video."}
            )
        return datos

    def _archivo(self, material, archivo, quitar=False):
        if archivo:
            material.archivo.save(archivo.name, archivo, save=False)
            material.archivo_nombre = archivo.name[:255]
            material.archivo_tipo = getattr(self, "_tipo_archivo", "")
        elif quitar and material.archivo:
            try:
                material.archivo.delete(save=False)
            except OSError:
                # En Windows no se borra un archivo abierto (alguien lo está
                # descargando): se suelta igual del material y queda huérfano.
                material.archivo = ""
            material.archivo_nombre = ""
            material.archivo_tipo = ""

    def create(self, datos):
        datos.pop("quitar_archivo", None)
        archivo = datos.pop("archivo", None)
        material = Material(**datos)
        self._archivo(material, archivo)
        material.save()
        return material

    def update(self, material, datos):
        quitar = datos.pop("quitar_archivo", False)
        archivo = datos.pop("archivo", None)
        for campo, valor in datos.items():
            setattr(material, campo, valor)
        self._archivo(material, archivo, quitar)
        material.save()
        return material


class OpcionEntradaSerializer(serializers.Serializer):
    texto = serializers.CharField(max_length=300, allow_blank=True)
    correcta = serializers.BooleanField(default=False)
    #: En «unir»: la respuesta que va con este concepto.
    pareja = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")


class PreguntaEntradaSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(
        choices=["unica", "multiple", "completar", "unir"], default="unica"
    )
    texto = serializers.CharField(max_length=2000, allow_blank=True)
    puntos = serializers.DecimalField(max_digits=4, decimal_places=2)
    opciones = OpcionEntradaSerializer(many=True, required=False, default=list)


class PreguntasSerializer(serializers.Serializer):
    preguntas = PreguntaEntradaSerializer(many=True)


class RespuestasSerializer(serializers.Serializer):
    #: Por pregunta: una opción, una lista de opciones, una lista de
    #: palabras o `{concepto_id: respuesta}`, según su tipo.
    respuestas = serializers.DictField(child=serializers.JSONField())
    #: Lo envía la pantalla cuando el reloj llega a cero.
    tiempo_agotado = serializers.BooleanField(required=False, default=False)


class AsignarSerializer(serializers.Serializer):
    usuarios = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    dias = serializers.IntegerField(min_value=1, max_value=180, default=15)


class DevolverSerializer(serializers.Serializer):
    usuario = serializers.IntegerField()
    material = serializers.IntegerField()
