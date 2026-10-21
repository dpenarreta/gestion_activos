from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import Requiere

from . import services
from .models import Reporte
from .serializers import (
    MODULOS,
    DetalleReporteSerializer,
    EstadoSerializer,
    NuevoReporteSerializer,
    ReporteSerializer,
    TextoSerializer,
)

MODULO = "sugerencias"


class ReporteViewSet(viewsets.GenericViewSet):
    """Sugerencias y errores. Cualquiera reporta; listar, abrir, comentar y
    cambiar el estado pide `sugerencias.gestionar` (los reportes son
    reservados). No se editan ni se borran."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser]

    def get_permissions(self):
        # Reportar pide su permiso (21/10/2026); lo demás lo decide
        # `sugerencias.gestionar` dentro de cada acción.
        if self.action == "create":
            return [IsAuthenticated(), Requiere("sugerencias.reportar", "sugerencias.gestionar")()]
        return super().get_permissions()

    def get_queryset(self):
        return Reporte.objects.select_related("autor").prefetch_related("comentarios__autor")

    def _reporte(self, request, pk):
        reporte = self.get_queryset().filter(pk=pk).first()
        if reporte is None or not services.puede_ver(reporte, request.user):
            raise Http404("No se encontró el reporte.")
        return reporte

    def _detalle(self, reporte):
        reporte.refresh_from_db()
        return Response(DetalleReporteSerializer(reporte).data)

    def list(self, request):
        if not services.gestiona(request.user):
            return Response(
                {"detail": "No tiene el permiso requerido: sugerencias.gestionar."},
                status=status.HTTP_403_FORBIDDEN,
            )
        vista = request.query_params.get("vista", "mios")
        queryset = self.get_queryset()
        if vista != "todos":
            queryset = queryset.filter(autor=request.user)
        for campo in ("estado", "tipo", "modulo"):
            valor = request.query_params.get(campo)
            if valor:
                queryset = queryset.filter(**{campo: valor})
        return Response(ReporteSerializer(queryset[:300], many=True).data)

    def retrieve(self, request, pk=None):
        return self._detalle(self._reporte(request, pk))

    def create(self, request):
        entrada = NuevoReporteSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        reporte = services.crear(
            request.user,
            tipo=datos["tipo"],
            titulo=datos["titulo"],
            descripcion=datos["descripcion"],
            modulo=datos["modulo"],
            impacto=datos.get("impacto", ""),
            captura=datos.get("captura"),
            captura_tipo=getattr(entrada, "_tipo", ""),
        )
        record_audit_event(
            actor=request.user,
            action="sugerencias.reporte.creado",
            target=reporte,
            module=MODULO,
            new_values={"tipo": reporte.tipo, "titulo": reporte.titulo},
            context=get_request_context(request),
        )
        if services.gestiona(request.user):
            datos = DetalleReporteSerializer(reporte).data
        else:
            # Quien no gestiona no ve reportes: solo la constancia del envío.
            datos = {"id": reporte.id, "titulo": reporte.titulo, "tipo": reporte.tipo}
        return Response(datos, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def opciones(self, request):
        return Response(
            {
                "modulos": [{"id": k, "nombre": v} for k, v in MODULOS.items()],
                "impactos": [{"id": k, "nombre": v} for k, v in Reporte.Impacto.choices],
                "estados": [{"id": k, "nombre": v} for k, v in Reporte.Estado.choices],
                "gestiona": services.gestiona(request.user),
            }
        )

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        """Cuántos reportes nuevos hay (para quien gestiona)."""
        if not services.gestiona(request.user):
            return Response({"nuevos": 0})
        return Response({"nuevos": Reporte.objects.filter(estado=Reporte.Estado.NUEVO).count()})

    @action(detail=True, methods=["post"])
    def comentar(self, request, pk=None):
        reporte = self._reporte(request, pk)
        entrada = TextoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        services.comentar(reporte, request.user, entrada.validated_data["texto"])
        return self._detalle(reporte)

    @action(detail=True, methods=["post"])
    def estado(self, request, pk=None):
        reporte = self._reporte(request, pk)
        entrada = EstadoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        anterior = reporte.estado
        services.cambiar_estado(
            reporte, request.user, entrada.validated_data["estado"], entrada.validated_data["texto"]
        )
        record_audit_event(
            actor=request.user,
            action="sugerencias.reporte.estado",
            target=reporte,
            module=MODULO,
            previous_values={"estado": anterior},
            new_values={"estado": reporte.estado},
            context=get_request_context(request),
        )
        return self._detalle(reporte)

    @action(detail=True, methods=["get"])
    def captura(self, request, pk=None):
        reporte = self._reporte(request, pk)
        if not reporte.captura:
            raise Http404("El reporte no tiene captura.")
        try:
            fichero = reporte.captura.open("rb")
        except FileNotFoundError as error:
            raise Http404("La captura ya no está disponible.") from error
        respuesta = FileResponse(
            fichero, content_type=reporte.captura_tipo or "application/octet-stream"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
