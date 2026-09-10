"""Las empresas del grupo: el selector del menú y su administración."""

from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context

from .contexto import SIN_EMPRESA, empresa_actual
from .models import Empresa
from .permissions import EmpresasPermission
from .serializers import EmpresaAdminSerializer, EmpresaSerializer
from .servicios import empresas_de

MODULO = "empresas"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mis_empresas(request):
    """Las del selector del menú, y cuál está activa ahora mismo.

    Sin permiso del catálogo a propósito: no es administrar empresas sino saber
    en cuál se está trabajando, y eso lo necesita cualquiera que entre —
    incluido quien solo consulta el inventario de la suya.

    La activa la resuelve el middleware a partir de la cabecera; se devuelve
    aquí para que el frontend pueda mostrar en qué empresa está sin tener que
    deducirlo de lo que él mismo mandó: si pidió una a la que no pertenece, lo
    que ve no es lo que pidió, y eso tiene que notarse.
    """
    disponibles = empresas_de(request.user)
    # Se pregunta al contexto y no al `request`: la empresa se resuelve al
    # primer uso, y esta vista no consulta ningún modelo por empresa, así que
    # sin preguntar explícitamente nadie la habría resuelto todavía.
    activa = empresa_actual()
    if activa is SIN_EMPRESA:
        activa = None
    return Response(
        {
            "empresas": EmpresaSerializer(disponibles, many=True).data,
            "activa": EmpresaSerializer(activa).data if activa else None,
        }
    )


class EmpresaViewSet(viewsets.ModelViewSet):
    """Alta y mantenimiento de las empresas.

    Sin `DELETE`: la empresa es el dueño de todo lo registrado —activos,
    catálogos, mantenimientos— y las relaciones son `PROTECT`, así que borrarla
    o fallaría o dejaría un inventario huérfano. Se desactiva con
    `activa = False`, que la saca del selector y deja su historial en pie.

    No se filtra por la empresa activa: esta es la pantalla desde la que se
    administran todas, y verse solo a sí misma haría imposible crear la
    segunda. El permiso `empresas.ver` es el que decide quién llega aquí.
    """

    queryset = Empresa.objects.all().order_by("nombre")
    serializer_class = EmpresaAdminSerializer
    permission_classes = [IsAuthenticated, EmpresasPermission]
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def perform_create(self, serializer):
        empresa = serializer.save()
        record_audit_event(
            actor=self.request.user,
            action="empresa.created",
            target=empresa,
            module=MODULO,
            new_values=serializer.data,
            context=get_request_context(self.request),
        )

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        empresa = serializer.save()
        cambios = {
            campo: valor
            for campo, valor in serializer.data.items()
            if anteriores.get(campo) != valor
        }
        if cambios:
            record_audit_event(
                actor=self.request.user,
                action="empresa.updated",
                target=empresa,
                module=MODULO,
                previous_values={campo: anteriores.get(campo) for campo in cambios},
                new_values=cambios,
                context=get_request_context(self.request),
            )
