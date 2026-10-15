import re
import zoneinfo

from rest_framework import serializers

from .models import Empresa, MembresiaEmpresa


class EmpresaSerializer(serializers.ModelSerializer):
    """La empresa tal como la ve el selector del menú: solo lectura.

    El alta y la edición pasan por `EmpresaAdminSerializer`, que exige el
    permiso correspondiente; este se usa donde cualquier cuenta autenticada
    necesita saber en qué empresa está.
    """

    class Meta:
        model = Empresa
        fields = ["id", "nombre", "codigo", "identificacion", "activa", "color", "zona_horaria"]
        read_only_fields = fields


class EmpresaAdminSerializer(serializers.ModelSerializer):
    """Alta y edición de la ficha de la empresa."""

    usuarios = serializers.SerializerMethodField()

    class Meta:
        model = Empresa
        fields = [
            "id",
            "nombre",
            "codigo",
            "identificacion",
            "activa",
            "usuarios",
            "zona_horaria",
            "color",
            "gerente_general",
            "gerente_general_nombre",
            "base_cumplimiento",
            "matriz_crear_para_otros",
        ]

    gerente_general_nombre = serializers.SerializerMethodField()

    def get_gerente_general_nombre(self, obj: Empresa) -> str | None:
        gerente = obj.gerente_general
        if gerente is None:
            return None
        return gerente.get_full_name() or gerente.username

    def validate_zona_horaria(self, value: str) -> str:
        try:
            zoneinfo.ZoneInfo(value)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError(
                f"«{value}» no es una zona horaria conocida (ej.: America/Guayaquil)."
            ) from None
        return value

    def validate_color(self, value: str) -> str:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value or ""):
            raise serializers.ValidationError("El color va en hexadecimal: #RRGGBB.")
        return value.upper()

    def validate(self, attrs):
        # El gerente aprueba por defecto los períodos de la Matriz: tiene que
        # poder entrar a la empresa, o los cierres quedarían esperando a alguien
        # que no ve nada de ella.
        gerente = attrs.get("gerente_general")
        if gerente is not None and self.instance is not None:
            if not self.instance.membresias.filter(usuario=gerente).exists():
                raise serializers.ValidationError(
                    {"gerente_general": "El gerente general debe trabajar en la empresa."}
                )
        return attrs

    def get_usuarios(self, obj: Empresa) -> int:
        """Cuántas cuentas trabajan en ella.

        Se muestra en el listado porque una empresa sin usuarios asignados no
        la ve nadie, y desde fuera parece que el sistema perdió los datos.
        """
        return obj.membresias.count()

    def validate_codigo(self, value: str) -> str:
        return value.strip().upper()


class MembresiaSerializer(serializers.ModelSerializer):
    """En qué empresa trabaja una cuenta y con qué rol, junto al usuario."""

    id = serializers.IntegerField(source="empresa_id", read_only=True)
    nombre = serializers.CharField(source="empresa.nombre", read_only=True)
    codigo = serializers.CharField(source="empresa.codigo", read_only=True)
    roles = serializers.SerializerMethodField()
    areas = serializers.SerializerMethodField()

    class Meta:
        model = MembresiaEmpresa
        fields = ["id", "nombre", "codigo", "es_predeterminada", "roles", "areas"]
        read_only_fields = fields

    def get_roles(self, obj: MembresiaEmpresa) -> list[dict]:
        return [{"id": rol.id, "name": rol.name} for rol in obj.roles.all()]

    def get_areas(self, obj: MembresiaEmpresa) -> list[dict]:
        """Las áreas de la Matriz de la membresía (§8.7)."""
        return [{"id": area.id, "nombre": area.nombre} for area in obj.areas_matriz.all()]
