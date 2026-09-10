"""Configuración de las columnas de la plantilla de carga masiva."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context

from .models_plantilla import CAMPOS_DISPONIBLES, CAMPOS_ESTRUCTURALES, ColumnaPlantillaActivos
from .permissions import ColumnasPlantillaPermission
from .serializers_plantilla import CampoDisponibleSerializer, ColumnaPlantillaSerializer

MODULO = "activos"


class ColumnaPlantillaViewSet(viewsets.ModelViewSet):
    """Columnas que la plantilla de carga masiva pide.

    Configurar qué se exige es administrar el módulo, no capturar datos: quien
    carga inventario no debería poder cambiar qué se le pide al resto. Por eso
    escribir aquí requiere `activos.editar` y no `activos.crear`.
    """

    permission_classes = [IsAuthenticated, ColumnasPlantillaPermission]
    serializer_class = ColumnaPlantillaSerializer

    def get_queryset(self):
        """Se resuelve por petición, no en el cuerpo de la clase.

        Un `queryset = Modelo.objects...` como atributo se evalúa **al importar
        el módulo**, y el gestor por empresa filtra en ese momento: la primera
        petición que cargue las URLs decide el filtro para todo el proceso. Si
        esa primera es anónima —el sondeo de salud de un balanceador es
        exactamente eso— el gestor devuelve «ninguna empresa» y este endpoint
        queda vacío hasta que alguien reinicie el servidor.
        """
        return ColumnaPlantillaActivos.objects.all().order_by("orden", "id")

    def perform_create(self, serializer):
        columna = serializer.save()
        self._auditar("columna_plantilla.created", columna, nuevos=serializer.data)

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        columna = serializer.save()
        cambios = {
            campo: valor
            for campo, valor in serializer.data.items()
            if anteriores.get(campo) != valor
        }
        if cambios:
            self._auditar(
                "columna_plantilla.updated",
                columna,
                previos={campo: anteriores.get(campo) for campo in cambios},
                nuevos=cambios,
            )

    def perform_destroy(self, instance):
        if instance.es_estructural:
            raise ValidationError(
                {
                    "detail": (
                        f"«{instance.etiqueta}» no se puede eliminar: sin ese dato no es "
                        "posible crear el activo."
                    )
                }
            )
        self._auditar(
            "columna_plantilla.deleted",
            instance,
            previos={"clave": instance.clave, "etiqueta": instance.etiqueta},
        )
        instance.delete()

    def _auditar(self, accion, columna, previos=None, nuevos=None):
        record_audit_event(
            actor=self.request.user,
            action=accion,
            target=columna,
            module=MODULO,
            previous_values=previos,
            new_values=nuevos,
            context=get_request_context(self.request),
        )

    @action(detail=False, methods=["get"], url_path="campos-disponibles")
    def campos_disponibles(self, request):
        """Campos del activo que una columna puede llenar.

        `en_uso` marca los que ya tienen columna: dos columnas para el mismo
        dato harían que la segunda pisara a la primera al leer el archivo.
        """
        en_uso = set(ColumnaPlantillaActivos.objects.values_list("clave", flat=True))
        datos = [
            {
                "clave": clave,
                "etiqueta": etiqueta,
                "es_estructural": clave in CAMPOS_ESTRUCTURALES,
                "en_uso": clave in en_uso,
            }
            for clave, etiqueta in CAMPOS_DISPONIBLES.items()
        ]
        return Response(CampoDisponibleSerializer(datos, many=True).data)
