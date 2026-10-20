from pathlib import PurePath

from rest_framework import serializers

from apps.adjuntos.models import FIRMAS

from .models import ComentarioReporte, Reporte

#: Los módulos del sistema a los que se refiere un reporte.
MODULOS = {
    "institucional": "Institucional",
    "dashboards": "Dashboards",
    "soporte": "Mesa de ayuda",
    "matriz": "Matriz",
    "ordenes": "Órdenes de trabajo",
    "activos": "Gestión de activos",
    "chat": "Chat",
    "general": "General (menú, inicio de sesión, perfil…)",
}
EXTENSIONES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
TAMANO_MAXIMO = 5 * 1024 * 1024


def _nombre(usuario):
    if usuario is None:
        return ""
    return usuario.get_full_name().strip() or usuario.username


class NuevoReporteSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=Reporte.Tipo.choices)
    titulo = serializers.CharField(max_length=150)
    descripcion = serializers.CharField(max_length=4000)
    modulo = serializers.ChoiceField(choices=list(MODULOS.items()))
    impacto = serializers.ChoiceField(
        choices=Reporte.Impacto.choices, required=False, allow_blank=True
    )
    captura = serializers.FileField(required=False)

    def validate_titulo(self, valor):
        if not valor.strip():
            raise serializers.ValidationError("Escriba un título.")
        return valor

    def validate_descripcion(self, valor):
        if len(valor.strip()) < 10:
            raise serializers.ValidationError("Cuente un poco más (al menos 10 caracteres).")
        return valor

    def validate_captura(self, archivo):
        if archivo.size > TAMANO_MAXIMO:
            raise serializers.ValidationError("La captura pesa más de 5 MB.")
        extension = PurePath(archivo.name).suffix.lower()
        if extension not in EXTENSIONES:
            raise serializers.ValidationError("Adjunte una imagen JPG o PNG.")
        cabecera = archivo.read(8)
        archivo.seek(0)
        if not any(cabecera.startswith(f) for f in FIRMAS[extension]):
            raise serializers.ValidationError(
                f"El contenido no corresponde a un {extension}. "
                "Verifique que no se haya renombrado la extensión."
            )
        self._tipo = EXTENSIONES[extension]
        return archivo

    def validate(self, datos):
        if datos["tipo"] == Reporte.Tipo.ERROR and not datos.get("impacto"):
            raise serializers.ValidationError({"impacto": "Indique cuánto le afecta el error."})
        return datos


class ComentarioSerializer(serializers.ModelSerializer):
    autor = serializers.SerializerMethodField()
    estado_nuevo_display = serializers.SerializerMethodField()

    class Meta:
        model = ComentarioReporte
        fields = ["id", "autor", "texto", "estado_nuevo", "estado_nuevo_display", "created_at"]

    def get_autor(self, comentario):
        return {"id": comentario.autor_id, "nombre": _nombre(comentario.autor)}

    def get_estado_nuevo_display(self, comentario) -> str:
        return comentario.get_estado_nuevo_display() if comentario.estado_nuevo else ""


class ReporteSerializer(serializers.ModelSerializer):
    autor = serializers.SerializerMethodField()
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    impacto_display = serializers.CharField(source="get_impacto_display", read_only=True)
    modulo_display = serializers.SerializerMethodField()
    tiene_captura = serializers.SerializerMethodField()

    class Meta:
        model = Reporte
        fields = [
            "id",
            "tipo",
            "tipo_display",
            "titulo",
            "modulo",
            "modulo_display",
            "impacto",
            "impacto_display",
            "estado",
            "estado_display",
            "autor",
            "tiene_captura",
            "created_at",
            "cerrado_en",
        ]

    def get_autor(self, reporte):
        return {"id": reporte.autor_id, "nombre": _nombre(reporte.autor)}

    def get_modulo_display(self, reporte) -> str:
        return MODULOS.get(reporte.modulo, reporte.modulo)

    def get_tiene_captura(self, reporte) -> bool:
        return bool(reporte.captura)


class DetalleReporteSerializer(ReporteSerializer):
    comentarios = ComentarioSerializer(many=True, read_only=True)

    class Meta(ReporteSerializer.Meta):
        fields = ReporteSerializer.Meta.fields + ["descripcion", "comentarios"]


class TextoSerializer(serializers.Serializer):
    texto = serializers.CharField(allow_blank=True, default="", max_length=4000)


class EstadoSerializer(TextoSerializer):
    estado = serializers.ChoiceField(choices=Reporte.Estado.choices)
