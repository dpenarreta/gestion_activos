from urllib.parse import quote

from django.contrib.auth.models import Group
from django.http import FileResponse, Http404
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.organizacion.models import Cargo
from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import HasModulePermission

from . import restricciones, services
from .models import Destino, FlujoPermiso, SolicitudPermiso
from .serializers import (
    DestinoSerializer,
    DetalleSolicitudSerializer,
    EvaluarSerializer,
    FlujoParaSolicitarSerializer,
    FlujoSerializer,
    NuevaSolicitudSerializer,
    SolicitudSerializer,
)

MODULO = "licencias"


class ConfigurarPermission(HasModulePermission):
    view_permission = "licencias.configurar"
    write_permission = "licencias.configurar"


class FlujoViewSet(viewsets.ModelViewSet):
    """Los flujos de permiso, para configurarlos (pide
    `licencias.configurar`). Un flujo con solicitudes no se borra: se
    desactiva."""

    permission_classes = [IsAuthenticated, ConfigurarPermission]
    serializer_class = FlujoSerializer

    def get_queryset(self):
        return FlujoPermiso.objects.prefetch_related("pasos__aprobadores", "avisos")

    def _auditar(self, accion, flujo):
        record_audit_event(
            actor=self.request.user,
            action=f"licencias.flujo.{accion}",
            target=flujo,
            module=MODULO,
            new_values={"nombre": flujo.nombre},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        self._auditar("creado", serializer.save())

    def perform_update(self, serializer):
        self._auditar("editado", serializer.save())

    def destroy(self, request, *args, **kwargs):
        flujo = self.get_object()
        if flujo.solicitudes.exists():
            return Response(
                {
                    "detail": "Este tipo de permiso ya tiene solicitudes: desactívelo en lugar de borrarlo."
                },
                status=status.HTTP_409_CONFLICT,
            )
        self._auditar("borrado", flujo)
        flujo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class OpcionesView(APIView):
    """Personas, roles y cargos para elegir en un flujo o al escalar."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "personas": [
                    {"id": u.id, "nombre": u.get_full_name().strip() or u.username}
                    for u in services.personas_de_la_empresa().order_by(
                        "first_name", "last_name", "username"
                    )
                ],
                "roles": [{"id": g.id, "nombre": g.name} for g in Group.objects.order_by("name")],
                "cargos": [
                    {
                        "id": c.id,
                        "nombre": f"{c.nombre} · {c.unidad.nombre}" if c.unidad_id else c.nombre,
                    }
                    for c in Cargo.objects.filter(activo=True)
                    .select_related("unidad")
                    .order_by("nombre")
                ],
                "destinos": [{"id": v, "nombre": n} for v, n in Destino.choices],
            }
        )


class FlujosParaSolicitarView(APIView):
    """Los tipos de permiso que se pueden solicitar."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        flujos = FlujoPermiso.objects.filter(activo=True).prefetch_related("pasos__aprobadores")
        return Response(FlujoParaSolicitarSerializer(flujos, many=True).data)


class EvaluarView(APIView):
    """Las restricciones de un tipo de permiso para unas fechas, con si se
    cumplen: lo que ve quien solicita debajo de los días elegidos."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        flujo = FlujoPermiso.objects.filter(pk=pk, activo=True).first()
        if flujo is None:
            raise Http404("No se encontró el tipo de permiso.")
        entrada = EvaluarSerializer(data=request.query_params)
        entrada.is_valid(raise_exception=True)
        return Response(
            restricciones.evaluar(
                request.user,
                flujo,
                entrada.validated_data["desde"],
                entrada.validated_data["hasta"],
            )
        )


class _Comentario(serializers.Serializer):
    comentario = serializers.CharField(allow_blank=True, default="")


class SolicitudViewSet(viewsets.GenericViewSet):
    """Las solicitudes de permiso: las mías, las que tengo por aprobar y, con
    `licencias.ver_todas`, todas las de la empresa."""

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SolicitudPermiso.objects.select_related(
            "flujo", "solicitante", "paso_actual"
        ).prefetch_related("pendiente_de")

    def list(self, request):
        vista = request.query_params.get("vista", "mias")
        queryset = self.get_queryset()
        if vista == "por_aprobar":
            queryset = queryset.filter(
                pendiente_de=request.user, estado=SolicitudPermiso.Estado.PENDIENTE
            )
        elif vista == "todas":
            if not user_has_permission(request.user, "licencias.ver_todas"):
                return Response(
                    {"detail": "No tiene el permiso requerido: licencias.ver_todas."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        else:
            queryset = queryset.filter(solicitante=request.user)
        return Response(SolicitudSerializer(queryset.distinct()[:300], many=True).data)

    def _solicitud(self, request, pk):
        solicitud = self.get_queryset().filter(pk=pk).first()
        if solicitud is None or not services.puede_ver(solicitud, request.user):
            raise Http404("No se encontró la solicitud.")
        return solicitud

    def _detalle(self, request, solicitud):
        solicitud.refresh_from_db()
        return Response(DetalleSolicitudSerializer(solicitud, context={"request": request}).data)

    def retrieve(self, request, pk=None):
        return self._detalle(request, self._solicitud(request, pk))

    def create(self, request):
        entrada = NuevaSolicitudSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        solicitud = services.crear(
            request.user,
            datos["flujo"],
            desde=datos["desde"],
            hasta=datos["hasta"],
            motivo=datos["motivo"],
            adjunto=datos.get("adjunto"),
            tipo_adjunto=getattr(entrada, "_tipo", ""),
        )
        record_audit_event(
            actor=request.user,
            action="licencias.solicitud.creada",
            target=solicitud,
            module=MODULO,
            new_values={"flujo": solicitud.flujo.nombre, "desde": str(solicitud.desde)},
            context=get_request_context(request),
        )
        return Response(
            DetalleSolicitudSerializer(solicitud, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        return Response(
            {
                "por_aprobar": SolicitudPermiso.objects.filter(
                    pendiente_de=request.user, estado=SolicitudPermiso.Estado.PENDIENTE
                ).count(),
                # Sin rol asignado no se solicita nada (restricciones.tiene_rol).
                "puede_solicitar": restricciones.tiene_rol(request.user),
            }
        )

    def _accion(self, request, pk, hacer):
        solicitud = self._solicitud(request, pk)
        entrada = _Comentario(data=request.data)
        entrada.is_valid(raise_exception=True)
        hacer(solicitud, request.user, entrada.validated_data["comentario"])
        return self._detalle(request, solicitud)

    @action(detail=True, methods=["post"])
    def aprobar(self, request, pk=None):
        return self._accion(request, pk, services.aprobar)

    @action(detail=True, methods=["post"])
    def rechazar(self, request, pk=None):
        return self._accion(request, pk, services.rechazar)

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        return self._accion(request, pk, services.cancelar)

    @action(detail=True, methods=["post"])
    def escalar(self, request, pk=None):
        solicitud = self._solicitud(request, pk)
        destino = DestinoSerializer(data=request.data.get("destino") or {})
        destino.is_valid(raise_exception=True)

        class _Destino:
            pass

        objetivo = _Destino()
        objetivo.tipo = destino.validated_data["tipo"]
        for campo in ("usuario", "rol", "cargo"):
            valor = destino.validated_data.get(campo)
            setattr(objetivo, campo, valor)
            setattr(objetivo, f"{campo}_id", valor.pk if valor else None)
        services.escalar(solicitud, request.user, objetivo, request.data.get("comentario", ""))
        return self._detalle(request, solicitud)

    @action(detail=True, methods=["get"])
    def adjunto(self, request, pk=None):
        solicitud = self._solicitud(request, pk)
        if not solicitud.adjunto:
            raise Http404("La solicitud no tiene documento.")
        try:
            fichero = solicitud.adjunto.open("rb")
        except FileNotFoundError as error:
            raise Http404("El documento ya no está disponible.") from error
        respuesta = FileResponse(
            fichero, content_type=solicitud.adjunto_tipo or "application/octet-stream"
        )
        respuesta["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(solicitud.adjunto_nombre)}"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta
