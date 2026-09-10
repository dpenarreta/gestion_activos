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
        fields = ["id", "nombre", "codigo", "identificacion", "activa"]
        read_only_fields = fields


class EmpresaAdminSerializer(serializers.ModelSerializer):
    """Alta y edición de la ficha de la empresa."""

    usuarios = serializers.SerializerMethodField()

    class Meta:
        model = Empresa
        fields = ["id", "nombre", "codigo", "identificacion", "activa", "usuarios"]

    def get_usuarios(self, obj: Empresa) -> int:
        """Cuántas cuentas trabajan en ella.

        Se muestra en el listado porque una empresa sin usuarios asignados no
        la ve nadie, y desde fuera parece que el sistema perdió los datos.
        """
        return obj.membresias.count()

    def validate_codigo(self, value: str) -> str:
        return value.strip().upper()


class MembresiaSerializer(serializers.ModelSerializer):
    """En qué empresa trabaja una cuenta, para pintarlo junto al usuario."""

    id = serializers.IntegerField(source="empresa_id", read_only=True)
    nombre = serializers.CharField(source="empresa.nombre", read_only=True)
    codigo = serializers.CharField(source="empresa.codigo", read_only=True)

    class Meta:
        model = MembresiaEmpresa
        fields = ["id", "nombre", "codigo", "es_predeterminada"]
        read_only_fields = fields
