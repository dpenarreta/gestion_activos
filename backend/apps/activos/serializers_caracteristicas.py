"""Alta y edición de las características que describe cada tipo de equipo."""

from django.core.exceptions import ValidationError as ErrorDeModelo
from rest_framework import serializers

from apps.empresas.campos import RelacionDeEmpresa

from .models import TipoDispositivo
from .models_caracteristicas import CaracteristicaTipo


class CaracteristicaTipoSerializer(serializers.ModelSerializer):
    tipo = RelacionDeEmpresa(TipoDispositivo, {})
    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True)
    # Sin el validador automático de unicidad: dispara antes que `validate` y
    # contesta con el nombre técnico de la restricción en vez de decir con cuál
    # característica choca.
    nombre = serializers.CharField(max_length=80, validators=[])

    class Meta:
        model = CaracteristicaTipo
        fields = [
            "id",
            "tipo",
            "tipo_nombre",
            "nombre",
            "unidad",
            "dato",
            "opciones",
            "obligatoria",
            "orden",
            "activa",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tipo_nombre", "created_at", "updated_at"]
        # Sin el validador automático de unicidad del par (tipo, nombre): se
        # dispara antes que `validate` y contesta «Los campos tipo, nombre deben
        # formar un conjunto único», que nombra la restricción y no el problema.
        # El de abajo dice con cuál característica choca y por qué importa.
        validators = []

    def validate_opciones(self, value):
        """Limpia la lista antes de guardarla.

        Las opciones llegan de un campo de texto donde alguien escribe una por
        línea: sin limpiar, «Windows 11 » y «Windows 11» serían dos opciones
        distintas en el desplegable, que es la dispersión que este modelo viene
        a evitar.
        """
        if not isinstance(value, list):
            raise serializers.ValidationError("Las opciones son una lista de valores.")
        limpias, vistas = [], set()
        for opcion in value:
            texto = str(opcion).strip()
            if texto and texto.lower() not in vistas:
                vistas.add(texto.lower())
                limpias.append(texto)
        return limpias

    def validate(self, attrs):
        tipo = attrs.get("tipo") or getattr(self.instance, "tipo", None)
        nombre = attrs.get("nombre", getattr(self.instance, "nombre", "")).strip()

        if tipo and nombre:
            repetida = CaracteristicaTipo.objects.filter(tipo=tipo, nombre__iexact=nombre)
            if self.instance is not None:
                repetida = repetida.exclude(pk=self.instance.pk)
            existente = repetida.first()
            if existente is not None:
                raise serializers.ValidationError(
                    {
                        "nombre": (
                            f"«{tipo.nombre}» ya describe «{existente.nombre}». "
                            "Dos características con el mismo nombre guardarían "
                            "su valor en el mismo sitio."
                        )
                    }
                )
        attrs["nombre"] = nombre

        # Se reutiliza `clean()` del modelo en vez de repetir la regla aquí:
        # una lista sin opciones no es un caso distinto según por dónde entre.
        instancia = CaracteristicaTipo(
            **{
                "tipo": tipo,
                "nombre": nombre,
                "dato": attrs.get(
                    "dato", getattr(self.instance, "dato", CaracteristicaTipo.Dato.TEXTO)
                ),
                "opciones": attrs.get("opciones", getattr(self.instance, "opciones", [])),
            }
        )
        try:
            instancia.clean()
        except ErrorDeModelo as error:
            raise serializers.ValidationError(error.message_dict) from error

        return attrs
