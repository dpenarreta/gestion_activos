from django.db import transaction
from rest_framework import serializers

from apps.adjuntos.validators import validar_archivo
from apps.empresas.campos import RelacionDeEmpresa
from apps.licencias.models import APROBADORES_VALIDOS
from apps.licencias.serializers import DestinoSerializer, describir_destino

from .models import (
    AccionProyecto,
    AprobadorPasoProyecto,
    CampoProyecto,
    PasoProyecto,
    SolicitudProyecto,
    TipoCampo,
    TipoProyecto,
)

#: Lo que se acepta como plantilla y como plantilla llena: Word, Excel o PDF
#: (quien la llena puede guardarla como PDF).
EXTENSIONES = {".docx", ".xlsx", ".pdf"}
TIPOS = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pdf": "application/pdf",
}
MAXIMO_CAMPOS = 30
MAXIMO_OPCIONES = 50


def validar_documento(archivo) -> str:
    """Valida tamaño, extensión y contenido; devuelve su tipo MIME."""
    extension = validar_archivo(archivo)
    if extension not in EXTENSIONES:
        raise serializers.ValidationError("Use un archivo Word (.docx), Excel (.xlsx) o PDF.")
    return TIPOS[extension]


def _nombre(usuario):
    return (usuario.get_full_name().strip() or usuario.username) if usuario else ""


class CampoSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False, allow_null=True)
    etiqueta = serializers.CharField(max_length=120)
    tipo = serializers.ChoiceField(choices=TipoCampo.choices)
    opciones = serializers.ListField(
        child=serializers.CharField(max_length=120), required=False, default=list
    )
    obligatorio = serializers.BooleanField(default=False)
    ayuda = serializers.CharField(max_length=300, allow_blank=True, default="")

    def validate(self, datos):
        datos["etiqueta"] = datos["etiqueta"].strip()
        opciones = [o.strip() for o in datos.get("opciones", []) if o.strip()]
        if datos["tipo"] == TipoCampo.LISTA:
            if not opciones:
                raise serializers.ValidationError({"opciones": "Una lista necesita opciones."})
            if len(opciones) > MAXIMO_OPCIONES:
                raise serializers.ValidationError(
                    {"opciones": f"Como máximo {MAXIMO_OPCIONES} opciones."}
                )
            datos["opciones"] = list(dict.fromkeys(opciones))
        else:
            datos["opciones"] = []
        return datos


class PasoSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False, allow_null=True)
    nombre = serializers.CharField(max_length=120)
    aprobadores = DestinoSerializer(many=True)

    def validate_aprobadores(self, aprobadores):
        if not aprobadores:
            raise serializers.ValidationError("Cada paso necesita al menos a alguien que decida.")
        for aprobador in aprobadores:
            if aprobador["tipo"] not in APROBADORES_VALIDOS:
                raise serializers.ValidationError(
                    "Decide el jefe inmediato, una persona, un rol o un cargo."
                )
        return aprobadores


class TipoProyectoSerializer(serializers.ModelSerializer):
    """Un tipo de proyecto con su formulario y sus pasos, que se guardan
    juntos. La plantilla se carga aparte (`plantilla/`)."""

    campos = CampoSerializer(many=True, required=False)
    pasos = PasoSerializer(many=True)
    nombre = serializers.CharField(max_length=120, validators=[])
    tiene_plantilla = serializers.SerializerMethodField()
    solicitudes = serializers.SerializerMethodField()

    class Meta:
        model = TipoProyecto
        fields = [
            "id",
            "nombre",
            "descripcion",
            "activo",
            "orden",
            "tiene_plantilla",
            "plantilla_nombre",
            "campos",
            "pasos",
            "solicitudes",
        ]
        read_only_fields = ["plantilla_nombre"]

    def get_tiene_plantilla(self, tipo) -> bool:
        return bool(tipo.plantilla)

    def get_solicitudes(self, tipo) -> int:
        return tipo.solicitudes.count()

    def validate_nombre(self, valor):
        valor = valor.strip()
        repetido = TipoProyecto.objects.filter(nombre__iexact=valor)
        if self.instance is not None:
            repetido = repetido.exclude(pk=self.instance.pk)
        if repetido.exists():
            raise serializers.ValidationError(f"Ya hay un tipo de proyecto «{valor}».")
        return valor

    def validate_pasos(self, pasos):
        if not pasos:
            raise serializers.ValidationError("Agregue al menos un paso.")
        return pasos

    def validate_campos(self, campos):
        if len(campos) > MAXIMO_CAMPOS:
            raise serializers.ValidationError(f"Como máximo {MAXIMO_CAMPOS} campos.")
        etiquetas = [c["etiqueta"].lower() for c in campos]
        if len(etiquetas) != len(set(etiquetas)):
            raise serializers.ValidationError("Dos campos no pueden llamarse igual.")
        return campos

    def validate(self, datos):
        activo = datos.get("activo", getattr(self.instance, "activo", False))
        tiene_plantilla = bool(self.instance and self.instance.plantilla)
        if activo and not tiene_plantilla:
            raise serializers.ValidationError(
                {
                    "activo": "Cargue la plantilla antes de activarlo: sin ella nadie puede "
                    "solicitar."
                }
            )
        return datos

    def to_representation(self, tipo):
        datos = super().to_representation(tipo)
        datos["campos"] = [
            {
                "id": c.id,
                "clave": c.clave,
                "etiqueta": c.etiqueta,
                "tipo": c.tipo,
                "opciones": c.opciones,
                "obligatorio": c.obligatorio,
                "ayuda": c.ayuda,
            }
            for c in tipo.campos.order_by("orden", "id")
        ]
        datos["pasos"] = [
            {
                "id": paso.id,
                "nombre": paso.nombre,
                "aprobadores": [
                    DestinoSerializer().to_representation(a) for a in paso.aprobadores.all()
                ],
            }
            for paso in tipo.pasos.order_by("orden", "id")
        ]
        return datos

    def _guardar_campos(self, tipo, campos):
        """Los campos se actualizan en su lugar (conservan su clave); los que
        ya no vienen se borran. Las solicitudes guardan su propia copia."""
        existentes = {c.id: c for c in tipo.campos.all()}
        conservar = set()
        for orden, datos in enumerate(campos, start=1):
            campo = existentes.get(datos.get("id")) or CampoProyecto(tipo_proyecto=tipo)
            for nombre in ("etiqueta", "tipo", "opciones", "obligatorio", "ayuda"):
                setattr(campo, nombre, datos[nombre])
            campo.orden = orden
            campo.save()
            conservar.add(campo.id)
        tipo.campos.exclude(id__in=conservar).delete()

    def _guardar_pasos(self, tipo, pasos):
        """Los pasos se actualizan en su lugar: una solicitud en curso no
        pierde el paso en que va. Un paso que tiene solicitudes en curso no
        se puede quitar."""
        existentes = {p.id: p for p in tipo.pasos.all()}
        conservar = set()
        nuevos = []
        for orden, datos in enumerate(pasos, start=1):
            paso = existentes.get(datos.get("id"))
            if paso is None:
                paso = PasoProyecto(tipo_proyecto=tipo)
            paso.nombre = datos["nombre"].strip()
            paso.orden = orden
            paso.save()
            conservar.add(paso.id)
            nuevos.append((paso, datos["aprobadores"]))
        quitados = tipo.pasos.exclude(id__in=conservar)
        en_curso = SolicitudProyecto.objects.filter(
            paso_actual__in=quitados, estado=SolicitudProyecto.Estado.PENDIENTE
        )
        if en_curso.exists():
            nombres = ", ".join(sorted({s.paso_actual.nombre for s in en_curso}))
            raise serializers.ValidationError(
                {"pasos": f"Hay solicitudes en curso en «{nombres}»: ese paso no se puede quitar."}
            )
        quitados.delete()
        for paso, aprobadores in nuevos:
            paso.aprobadores.all().delete()
            for aprobador in aprobadores:
                AprobadorPasoProyecto.objects.create(
                    paso=paso,
                    tipo=aprobador["tipo"],
                    usuario=aprobador.get("usuario"),
                    rol=aprobador.get("rol"),
                    cargo=aprobador.get("cargo"),
                )

    @transaction.atomic
    def create(self, datos):
        campos = datos.pop("campos", [])
        pasos = datos.pop("pasos")
        tipo = TipoProyecto.objects.create(**datos)
        self._guardar_campos(tipo, campos)
        self._guardar_pasos(tipo, pasos)
        return tipo

    @transaction.atomic
    def update(self, tipo, datos):
        campos = datos.pop("campos", None)
        pasos = datos.pop("pasos", None)
        for campo, valor in datos.items():
            setattr(tipo, campo, valor)
        tipo.save()
        if campos is not None:
            self._guardar_campos(tipo, campos)
        if pasos is not None:
            self._guardar_pasos(tipo, pasos)
        return tipo


class PlantillaSerializer(serializers.Serializer):
    plantilla = serializers.FileField()

    def validate_plantilla(self, archivo):
        self._tipo = validar_documento(archivo)
        return archivo


class TipoParaSolicitarSerializer(serializers.ModelSerializer):
    """Lo que ve quien solicita: qué es, su plantilla, su formulario y por qué
    pasos va a pasar."""

    campos = serializers.SerializerMethodField()
    pasos = serializers.SerializerMethodField()

    class Meta:
        model = TipoProyecto
        fields = ["id", "nombre", "descripcion", "plantilla_nombre", "campos", "pasos"]

    def get_campos(self, tipo):
        return [
            {
                "clave": c.clave,
                "etiqueta": c.etiqueta,
                "tipo": c.tipo,
                "opciones": c.opciones,
                "obligatorio": c.obligatorio,
                "ayuda": c.ayuda,
            }
            for c in tipo.campos.order_by("orden", "id")
        ]

    def get_pasos(self, tipo):
        return [
            {
                "nombre": paso.nombre,
                "aprobadores": [describir_destino(a) for a in paso.aprobadores.all()],
            }
            for paso in tipo.pasos.order_by("orden", "id")
        ]


class NuevaSolicitudSerializer(serializers.Serializer):
    tipo_proyecto = RelacionDeEmpresa(TipoProyecto, {"activo": True})
    titulo = serializers.CharField(max_length=200)
    respuestas = serializers.CharField(allow_blank=True, required=False, default="")
    archivo = serializers.FileField(
        error_messages={
            "required": "Cargue la plantilla llena: descárguela, complétela y súbala aquí.",
            "empty": "El archivo está vacío.",
        }
    )

    def validate_archivo(self, archivo):
        self._tipo = validar_documento(archivo)
        return archivo


class AccionSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    accion_display = serializers.CharField(source="get_accion_display", read_only=True)
    paso = serializers.CharField(source="paso.nombre", default="", read_only=True)

    class Meta:
        model = AccionProyecto
        fields = [
            "id",
            "accion",
            "accion_display",
            "actor",
            "paso",
            "comentario",
            "detalle",
            "created_at",
        ]

    def get_actor(self, accion):
        return _nombre(accion.actor)


class SolicitudSerializer(serializers.ModelSerializer):
    tipo_proyecto = serializers.CharField(source="tipo_proyecto.nombre", read_only=True)
    solicitante = serializers.SerializerMethodField()
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    paso_actual = serializers.CharField(source="paso_actual.nombre", default="", read_only=True)
    pendiente_de = serializers.SerializerMethodField()

    class Meta:
        model = SolicitudProyecto
        fields = [
            "id",
            "numero",
            "tipo_proyecto",
            "titulo",
            "solicitante",
            "estado",
            "estado_display",
            "paso_actual",
            "pendiente_de",
            "created_at",
            "cerrada_en",
        ]

    def get_solicitante(self, solicitud):
        return {"id": solicitud.solicitante_id, "nombre": _nombre(solicitud.solicitante)}

    def get_pendiente_de(self, solicitud):
        return [{"id": u.id, "nombre": _nombre(u)} for u in solicitud.pendiente_de.all()]


class DetalleSolicitudSerializer(SolicitudSerializer):
    acciones = AccionSerializer(many=True, read_only=True)
    pasos = serializers.SerializerMethodField()
    puedo = serializers.SerializerMethodField()

    class Meta(SolicitudSerializer.Meta):
        fields = SolicitudSerializer.Meta.fields + [
            "respuestas",
            "archivo_nombre",
            "archivo_tamano",
            "pasos",
            "acciones",
            "puedo",
        ]

    def get_pasos(self, solicitud):
        """Los pasos del tipo, con cuál ya se aprobó y en cuál va."""
        aprobados = set(
            solicitud.acciones.filter(accion=AccionProyecto.Accion.APROBADA).values_list(
                "paso_id", flat=True
            )
        )
        return [
            {
                "nombre": paso.nombre,
                "estado": (
                    "aprobado"
                    if paso.id in aprobados
                    else "en_curso" if paso.id == solicitud.paso_actual_id else "pendiente"
                ),
            }
            for paso in solicitud.tipo_proyecto.pasos.order_by("orden", "id")
        ]

    def get_puedo(self, solicitud):
        from apps.permissions.authorization import user_has_permission

        usuario = self.context["request"].user
        pendiente = solicitud.estado == SolicitudProyecto.Estado.PENDIENTE
        mia = solicitud.pendiente_de.filter(pk=usuario.pk).exists()
        return {
            "resolver": pendiente and mia,
            "escalar": pendiente and (mia or user_has_permission(usuario, "proyectos.ver_todas")),
            "cancelar": pendiente and solicitud.solicitante_id == usuario.pk,
        }
