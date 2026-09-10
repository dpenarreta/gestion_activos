"""Qué empresas puede ver la cuenta y en cuál está trabajando."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .contexto import SIN_EMPRESA, empresa_actual
from .serializers import EmpresaSerializer
from .servicios import empresas_de


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mis_empresas(request):
    """Las del selector del menú, y cuál está activa ahora mismo.

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
