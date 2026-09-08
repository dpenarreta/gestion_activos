from rest_framework import serializers

from .models import CatalogoComponente, ComponenteUtilizado, Mantenimiento


class CatalogoComponenteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CatalogoComponente
        fields = [
            "id",
            "nombre",
            "codigo",
            "descripcion",
            "es_critico",
            "activo",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_codigo(self, value):
        return value.strip().upper()


class ComponenteUtilizadoSerializer(serializers.ModelSerializer):
    componente_nombre = serializers.CharField(source="componente.nombre", read_only=True)
    costo_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = ComponenteUtilizado
        fields = [
            "id",
            "componente",
            "componente_nombre",
            "cantidad",
            "costo_unitario",
            "costo_total",
            "numero_serie_nuevo",
            "era_critico",
            "observaciones",
        ]
        read_only_fields = ["id", "era_critico", "costo_total"]


class MantenimientoSerializer(serializers.ModelSerializer):
    componentes = ComponenteUtilizadoSerializer(many=True, read_only=True)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    tipo_responsable_display = serializers.CharField(
        source="get_tipo_responsable_display", read_only=True
    )
    activo_codigo = serializers.CharField(source="activo.codigo_barras", read_only=True)
    activo_nombre = serializers.CharField(source="activo.nombre", read_only=True)
    registrado_por_nombre = serializers.CharField(
        source="registrado_por.username", read_only=True, default=None
    )
    costo_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Mantenimiento
        fields = [
            "id",
            "activo",
            "activo_codigo",
            "activo_nombre",
            "tipo",
            "tipo_display",
            "fecha_intervencion",
            "tipo_responsable",
            "tipo_responsable_display",
            "responsable",
            "descripcion",
            "diagnostico",
            "costo_mano_obra",
            "costo_total",
            "componentes",
            "registrado_por_nombre",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ComponenteLineaSerializer(serializers.Serializer):
    """Una línea del desglose de repuestos al registrar un mantenimiento."""

    componente = serializers.PrimaryKeyRelatedField(
        queryset=CatalogoComponente.objects.filter(activo=True)
    )
    cantidad = serializers.IntegerField(min_value=1, default=1)
    costo_unitario = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    numero_serie_nuevo = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=120
    )
    observaciones = serializers.CharField(required=False, allow_blank=True, default="")


class MantenimientoWriteSerializer(serializers.ModelSerializer):
    componentes = ComponenteLineaSerializer(many=True, required=False)

    class Meta:
        model = Mantenimiento
        fields = [
            "activo",
            "tipo",
            "fecha_intervencion",
            "tipo_responsable",
            "responsable",
            "descripcion",
            "diagnostico",
            "costo_mano_obra",
            "componentes",
        ]

    def validate_fecha_intervencion(self, value):
        """Una intervención no puede ser futura: la bitácora registra trabajo
        hecho, no planificado. Programar mantenimientos es otro caso de uso y
        exigiría su propio modelo con estados."""
        from django.utils import timezone

        if value > timezone.localdate():
            raise serializers.ValidationError("La fecha de intervención no puede ser futura.")
        return value

    def validate(self, attrs):
        activo = attrs.get("activo") or getattr(self.instance, "activo", None)
        fecha = attrs.get("fecha_intervencion")
        if activo and fecha and fecha < activo.fecha_adquisicion:
            raise serializers.ValidationError(
                {
                    "fecha_intervencion": (
                        "La intervención es anterior a la fecha de adquisición del activo "
                        f"({activo.fecha_adquisicion})."
                    )
                }
            )
        return attrs

    def validate_activo(self, value):
        if value.estado == value.Estado.DADO_DE_BAJA:
            raise serializers.ValidationError(
                "No se registran mantenimientos sobre un activo dado de baja."
            )
        return value
