from rest_framework import serializers

from apps.organizacion.models import Departamento, Empleado
from apps.politicas.services import evaluar_activo

from .models import Activo, MovimientoActivo, TipoDispositivo


class TipoDispositivoSerializer(serializers.ModelSerializer):
    total_activos = serializers.IntegerField(read_only=True)
    tiene_politica = serializers.SerializerMethodField()

    class Meta:
        model = TipoDispositivo
        fields = [
            "id",
            "nombre",
            "codigo",
            "descripcion",
            "activo",
            "total_activos",
            "tiene_politica",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_tiene_politica(self, obj) -> bool:
        return hasattr(obj, "politica")

    def validate_codigo(self, value):
        """El código va dentro del código de barras, que se lee con lectores
        1D: se normaliza a mayúsculas y se restringe a alfanuméricos para que
        quepa en el subconjunto B de Code 128 sin escapes."""
        limpio = value.strip().upper()
        if not limpio.isalnum():
            raise serializers.ValidationError(
                "El código solo admite letras y dígitos (va codificado en la etiqueta)."
            )
        return limpio


class MovimientoActivoSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    custodio_anterior_nombre = serializers.CharField(
        source="custodio_anterior.nombre_completo", read_only=True, default=None
    )
    custodio_nuevo_nombre = serializers.CharField(
        source="custodio_nuevo.nombre_completo", read_only=True, default=None
    )
    departamento_anterior_nombre = serializers.CharField(
        source="departamento_anterior.nombre", read_only=True, default=None
    )
    departamento_nuevo_nombre = serializers.CharField(
        source="departamento_nuevo.nombre", read_only=True, default=None
    )
    registrado_por_nombre = serializers.CharField(
        source="registrado_por.username", read_only=True, default=None
    )

    class Meta:
        model = MovimientoActivo
        fields = [
            "id",
            "tipo",
            "tipo_display",
            "custodio_anterior_nombre",
            "custodio_nuevo_nombre",
            "departamento_anterior_nombre",
            "departamento_nuevo_nombre",
            "estado_anterior",
            "estado_nuevo",
            "motivo",
            "registrado_por_nombre",
            "created_at",
        ]
        read_only_fields = fields


class ActivoListSerializer(serializers.ModelSerializer):
    """Versión ligera para el listado: sin especificaciones ni historial."""

    estado_garantia = serializers.CharField(read_only=True)
    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    custodio_nombre = serializers.CharField(
        source="custodio.nombre_completo", read_only=True, default=None
    )
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)

    class Meta:
        model = Activo
        fields = [
            "id",
            "codigo_barras",
            "nombre",
            "tipo",
            "tipo_nombre",
            "marca",
            "modelo",
            "numero_serie",
            "custodio",
            "custodio_nombre",
            "departamento",
            "departamento_nombre",
            "ubicacion",
            "estado",
            "estado_display",
            "fecha_adquisicion",
            "estado_garantia",
            "fecha_fin_garantia",
            "total_mantenimientos",
            "total_componentes_criticos",
            "requiere_renovacion",
            "nivel_renovacion",
            "created_at",
        ]
        read_only_fields = fields


class ActivoDetailSerializer(serializers.ModelSerializer):
    """Ficha completa, incluido el veredicto de renovación en vivo.

    `renovacion` se calcula en cada lectura y no se toma de la columna
    `requiere_renovacion`: la longevidad cruza su umbral por el paso del
    tiempo, sin ningún evento que actualice la caché (ver
    `apps.politicas.services`).
    """

    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    custodio_nombre = serializers.CharField(
        source="custodio.nombre_completo", read_only=True, default=None
    )
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    antiguedad_meses = serializers.IntegerField(read_only=True)
    estado_garantia = serializers.CharField(read_only=True)
    estado_garantia_display = serializers.SerializerMethodField()
    dias_para_fin_de_garantia = serializers.IntegerField(read_only=True)
    dias_en_reparacion = serializers.SerializerMethodField()
    renovacion = serializers.SerializerMethodField()

    class Meta:
        model = Activo
        fields = [
            "id",
            "codigo_barras",
            "nombre",
            "tipo",
            "tipo_nombre",
            "marca",
            "modelo",
            "numero_serie",
            "especificaciones",
            "observaciones",
            "custodio",
            "custodio_nombre",
            "departamento",
            "departamento_nombre",
            "ubicacion",
            "estado",
            "estado_display",
            "fecha_adquisicion",
            "costo_adquisicion",
            "proveedor",
            "fecha_fin_garantia",
            "estado_garantia",
            "estado_garantia_display",
            "dias_para_fin_de_garantia",
            "fecha_baja",
            "motivo_baja",
            "antiguedad_meses",
            "dias_en_reparacion",
            "total_mantenimientos",
            "total_componentes_criticos",
            "renovacion",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "codigo_barras",
            "estado",
            "fecha_baja",
            "motivo_baja",
            "total_mantenimientos",
            "total_componentes_criticos",
            "created_at",
            "updated_at",
        ]

    def get_renovacion(self, obj) -> dict:
        return evaluar_activo(obj).as_dict()

    def get_estado_garantia_display(self, obj) -> str:
        return Activo.Garantia(obj.estado_garantia).label

    def get_dias_en_reparacion(self, obj) -> int:
        """Tiempo acumulado fuera de operación (§10 del documento funcional).

        Las intervenciones sin fecha de salida no suman: el equipo sigue fuera
        y ese tiempo todavía no está cerrado.
        """
        return sum(
            m.dias_fuera_de_operacion or 0
            for m in obj.mantenimientos.all()
            if m.fecha_salida is not None
        )


class ActivoWriteSerializer(serializers.ModelSerializer):
    """Alta y edición de la ficha técnica.

    No expone `estado`, `custodio` ni `departamento` en la edición: esos
    cambian por sus propias acciones (`asignar`, `cambiar-estado`), que dejan
    el movimiento correspondiente en el historial. Permitirlos aquí abriría una
    vía de cambiar de responsable sin dejar rastro.
    """

    class Meta:
        model = Activo
        fields = [
            "tipo",
            "nombre",
            "marca",
            "modelo",
            "numero_serie",
            "especificaciones",
            "observaciones",
            "custodio",
            "departamento",
            "ubicacion",
            "fecha_adquisicion",
            "costo_adquisicion",
            "proveedor",
            "fecha_fin_garantia",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            for campo in ("custodio", "departamento"):
                self.fields.pop(campo, None)

    def validate_numero_serie(self, value):
        return value.strip()

    def validate_especificaciones(self, value):
        """Solo pares clave/valor planos: la ficha se renderiza como tabla y
        un diccionario anidado no tendría cómo mostrarse."""
        if not isinstance(value, dict):
            raise serializers.ValidationError(
                "Las especificaciones deben ser un objeto de pares clave/valor."
            )
        for clave, valor in value.items():
            if isinstance(valor, (dict, list)):
                raise serializers.ValidationError(
                    f"El valor de {clave!r} debe ser un dato simple, no una estructura anidada."
                )
        return value


class AsignacionSerializer(serializers.Serializer):
    """Asignación, traslado o devolución de un activo.

    Los querysets filtran por `activo=True`: entregar un equipo a un empleado
    dado de baja, o adscribirlo a un área desactivada, reintroduce el problema
    de custodia sin dueño que RF-01 busca resolver.
    """

    custodio = serializers.PrimaryKeyRelatedField(
        queryset=Empleado.objects.filter(activo=True),
        allow_null=True,
        required=False,
        default=None,
    )
    departamento = serializers.PrimaryKeyRelatedField(
        queryset=Departamento.objects.filter(activo=True),
        required=False,
        allow_null=True,
        default=None,
    )
    motivo = serializers.CharField(required=False, allow_blank=True, default="")


class CambioEstadoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(choices=Activo.Estado.choices)
    motivo = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["estado"] == Activo.Estado.DADO_DE_BAJA and not attrs.get("motivo"):
            raise serializers.ValidationError(
                {"motivo": "Dar de baja un activo exige indicar el motivo."}
            )
        return attrs
