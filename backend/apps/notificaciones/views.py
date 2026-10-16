"""La campana: cada quien ve y marca solo sus propias notificaciones."""

from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.pagination import DefaultPagination

from . import services
from .modulos import MODULOS, describir
from .serializers import NotificacionSerializer

#: Cuántas trae la campana al abrirse.
RECIENTES = 8


class NotificacionViewSet(viewsets.ReadOnlyModelViewSet):
    """`GET /notificaciones/`: el historial, con `modulo` y `estado=no_leidas`.
    `GET /notificaciones/resumen/`: lo de la campana (contador y recientes)."""

    serializer_class = NotificacionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = DefaultPagination

    def get_queryset(self):
        consulta = services.de(self.request.user)
        modulo = self.request.query_params.get("modulo")
        if modulo:
            consulta = consulta.filter(modulo=modulo)
        if self.request.query_params.get("estado") == "no_leidas":
            consulta = consulta.filter(leida_en__isnull=True)
        return consulta.order_by("-created_at", "-id")

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        propias = services.de(request.user)
        return Response(
            {
                "no_leidas": propias.filter(leida_en__isnull=True).count(),
                "recientes": NotificacionSerializer(
                    propias.order_by("-created_at", "-id")[:RECIENTES], many=True
                ).data,
            }
        )

    @action(detail=False, methods=["get"])
    def modulos(self, request):
        """Los módulos para el filtro del historial."""
        return Response([{"id": clave, "nombre": describir(clave)[0]} for clave in MODULOS])

    @action(detail=True, methods=["post"])
    def leer(self, request, pk=None):
        notificacion = get_object_or_404(services.de(request.user), pk=pk)
        return Response(NotificacionSerializer(services.marcar_leida(notificacion)).data)

    @action(detail=False, methods=["post"], url_path="leer-todas")
    def leer_todas(self, request):
        return Response({"marcadas": services.marcar_todas(request.user)})
