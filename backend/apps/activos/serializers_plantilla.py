from rest_framework import serializers

from .models_plantilla import (
    CAMPOS_DISPONIBLES,
    CAMPOS_ESTRUCTURALES,
    PREFIJO_ESPECIFICACION,
    ColumnaPlantillaActivos,
)


class ColumnaPlantillaSerializer(serializers.ModelSerializer):
    es_estructural = serializers.BooleanField(read_only=True)
    es_especificacion = serializers.BooleanField(read_only=True)
    encabezado = serializers.CharField(read_only=True)

    class Meta:
        model = ColumnaPlantillaActivos
        fields = [
            "id",
            "clave",
            "etiqueta",
            "ayuda",
            "obligatoria",
            "activa",
            "orden",
            "es_estructural",
            "es_especificacion",
            "encabezado",
        ]
        read_only_fields = ["id", "es_estructural", "es_especificacion", "encabezado"]

    def validate_clave(self, value):
        """Al editar, la clave no cambia.

        Cambiarla convertiría una columna en otra distinta conservando su orden
        y su etiqueta, lo que confunde más de lo que ayuda: para pedir otro dato
        se desactiva esta columna y se crea la que corresponda.
        """
        if self.instance is not None and value != self.instance.clave:
            raise serializers.ValidationError(
                "La clave no se puede cambiar. Desactive esta columna y cree la que necesita."
            )

        limpia = value.strip()
        if limpia.startswith(PREFIJO_ESPECIFICACION):
            nombre = limpia[len(PREFIJO_ESPECIFICACION) :].strip()
            if not nombre:
                raise serializers.ValidationError(
                    "Indique el nombre de la característica después de 'espec:'."
                )
            return f"{PREFIJO_ESPECIFICACION}{nombre}"

        if limpia not in CAMPOS_DISPONIBLES:
            raise serializers.ValidationError(
                f"{limpia!r} no es un campo del activo. Para pedir un dato propio use "
                f"'espec:<Nombre>', que se guarda en las especificaciones del equipo."
            )
        return self._sin_repetir(limpia)

    def _sin_repetir(self, clave):
        """Dos columnas pidiendo el mismo campo: la segunda pisaría a la
        primera al leer el archivo.

        La comprobación se hace aquí y ya no la hereda del modelo: la clave dejó
        de ser única en toda la base para serlo **dentro de cada empresa**, y
        `ColumnaPlantillaActivos.objects` ya viene acotado a la activa.
        """
        existente = ColumnaPlantillaActivos.objects.filter(clave=clave)
        if self.instance is not None:
            existente = existente.exclude(pk=self.instance.pk)
        choque = existente.first()
        if choque:
            raise serializers.ValidationError(
                f"«{choque.etiqueta}» ya pide ese campo. Edítela o desactívela."
            )
        return clave

    def validate(self, attrs):
        clave = attrs.get("clave") or getattr(self.instance, "clave", "")
        if clave in CAMPOS_ESTRUCTURALES:
            if attrs.get("activa", True) is False:
                raise serializers.ValidationError(
                    {"activa": "Sin este dato no es posible crear el activo."}
                )
            if attrs.get("obligatoria", True) is False:
                raise serializers.ValidationError(
                    {"obligatoria": "Sin este dato no es posible crear el activo."}
                )
        return attrs


class CampoDisponibleSerializer(serializers.Serializer):
    """Catálogo de campos que una columna puede llenar, para el selector."""

    clave = serializers.CharField()
    etiqueta = serializers.CharField()
    es_estructural = serializers.BooleanField()
    en_uso = serializers.BooleanField()
