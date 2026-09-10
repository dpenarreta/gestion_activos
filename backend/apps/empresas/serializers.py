from rest_framework import serializers

from .models import Empresa


class EmpresaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Empresa
        fields = ["id", "nombre", "codigo", "identificacion", "activa"]
        read_only_fields = fields
