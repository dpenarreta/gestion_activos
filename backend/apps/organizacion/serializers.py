from rest_framework import serializers

from .models import Departamento, Empleado


class DepartamentoSerializer(serializers.ModelSerializer):
    responsable_nombre = serializers.CharField(source="responsable.nombre_completo", read_only=True)
    total_activos = serializers.IntegerField(read_only=True)
    total_empleados = serializers.IntegerField(read_only=True)

    class Meta:
        model = Departamento
        fields = [
            "id",
            "nombre",
            "codigo",
            "descripcion",
            "responsable",
            "responsable_nombre",
            "activo",
            "total_activos",
            "total_empleados",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_codigo(self, value):
        return value.strip().upper()


class EmpleadoSerializer(serializers.ModelSerializer):
    nombre_completo = serializers.CharField(read_only=True)
    departamento_nombre = serializers.CharField(source="departamento.nombre", read_only=True)
    total_activos = serializers.IntegerField(read_only=True)

    class Meta:
        model = Empleado
        fields = [
            "id",
            "nombres",
            "apellidos",
            "nombre_completo",
            "documento_identidad",
            "correo",
            "telefono",
            "cargo",
            "departamento",
            "departamento_nombre",
            "usuario",
            "activo",
            "total_activos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_documento_identidad(self, value):
        return value.strip()
