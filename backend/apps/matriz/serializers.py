from rest_framework import serializers

from .models import Area, EntidadControl


class _CatalogoSerializer(serializers.ModelSerializer):
    class Meta:
        fields = ["id", "codigo", "nombre"]

    def validate_codigo(self, value: str) -> str:
        limpio = value.strip().upper()
        if not limpio:
            raise serializers.ValidationError("El código no puede quedar vacío.")
        return limpio

    def validate_nombre(self, value: str) -> str:
        limpio = value.strip()
        if not limpio:
            raise serializers.ValidationError("El nombre no puede quedar vacío.")
        return limpio


class AreaSerializer(_CatalogoSerializer):
    class Meta(_CatalogoSerializer.Meta):
        model = Area


class EntidadControlSerializer(_CatalogoSerializer):
    class Meta(_CatalogoSerializer.Meta):
        model = EntidadControl
