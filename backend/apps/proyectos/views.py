from urllib.parse import quote

from django.contrib.auth.models import Group
from django.http import FileResponse, Http404
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.licencias.models import Destino
from apps.licencias.serializers import DestinoSerializer
from apps.organizacion.models import Cargo
from apps.permissions.authorization import user_has_permission
from apps.permissions.permissions import HasModulePermission

from . import services
from .models import SolicitudProyecto, TipoProyecto
from .serializers import (
    DetalleSolicitudSerializer,
    NuevaSolicitudSerializer,
    PlantillaSerializer,
    SolicitudSerializer,
    TipoParaSolicitarSerializer,
    TipoProyectoSerializer,
)

MODULO = "proyectos"


def _descargar(campo, nombre, tipo):
    """Entrega un archivo guardado, siempre como descarga."""
    try:
        fichero = campo.open("rb")
    except FileNotFoundError as error:
        raise Http404("El archivo ya no está disponible.") from error
    respuesta = FileResponse(fichero, content_type=tipo or "application/octet-stream")
    respuesta["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(nombre)}"
    respuesta["X-Content-Type-Options"] = "nosniff"
    return respuesta


class ConfigurarPermission(HasModulePermission):
    view_permission = "proyectos.configurar"
    write_permission = "proyectos.configurar"


class TipoProyectoViewSet(viewsets.ModelViewSet):
    """Los tipos de proyecto, para configurarlos (pide `proyectos.configurar`):
    su formulario, sus pasos y su plantilla. Un tipo con solicitudes no se
    borra: se desactiva."""

    permission_classes = [IsAuthenticated, ConfigurarPermission]
    serializer_class = TipoProyectoSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return TipoProyecto.objects.prefetch_related("campos", "pasos__aprobadores")

    def _auditar(self, accion, tipo, **valores):
        record_audit_event(
            actor=self.request.user,
            action=f"proyectos.tipo.{accion}",
            target=tipo,
            module=MODULO,
            new_values={"nombre": tipo.nombre, **valores},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        self._auditar("creado", serializer.save())

    def perform_update(self, serializer):
        self._auditar("editado", serializer.save())

    def destroy(self, request, *args, **kwargs):
        tipo = self.get_object()
        if tipo.solicitudes.exists():
            return Response(
                {
                    "detail": "Este tipo de proyecto ya tiene solicitudes: desactívelo en lugar "
                    "de borrarlo."
                },
                status=status.HTTP_409_CONFLICT,
            )
        self._auditar("borrado", tipo)
        if tipo.plantilla:
            tipo.plantilla.delete(save=False)
        tipo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "post"])
    def plantilla(self, request, pk=None):
        """GET la descarga; POST carga una nueva (reemplaza la anterior)."""
        tipo = self.get_object()
        if request.method == "GET":
            if not tipo.plantilla:
                raise Http404("Este tipo de proyecto todavía no tiene plantilla.")
            return _descargar(tipo.plantilla, tipo.plantilla_nombre, tipo.plantilla_tipo)
        entrada = PlantillaSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        archivo = entrada.validated_data["plantilla"]
        anterior = tipo.plantilla.name if tipo.plantilla else ""
        tipo.plantilla.save(archivo.name, archivo, save=False)
        tipo.plantilla_nombre = archivo.name[:255]
        tipo.plantilla_tipo = entrada._tipo
        tipo.save(update_fields=["plantilla", "plantilla_nombre", "plantilla_tipo", "updated_at"])
        if anterior:
            tipo.plantilla.storage.delete(anterior)
        self._auditar("plantilla", tipo, plantilla=tipo.plantilla_nombre)
        return Response(TipoProyectoSerializer(tipo).data)


class OpcionesView(APIView):
    """Personas, roles y cargos para elegir quién decide un paso o a quién se
    escala. La ve quien configura, quien ve todas o quien tiene alguna
    solicitud pendiente de decidir."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        usuario = request.user
        puede = (
            user_has_permission(usuario, "proyectos.configurar")
            or user_has_permission(usuario, "proyectos.ver_todas")
            or SolicitudProyecto.objects.filter(
                estado=SolicitudProyecto.Estado.PENDIENTE, pendiente_de=usuario
            ).exists()
        )
        if not puede:
            raise PermissionDenied("No tiene el permiso requerido: proyectos.configurar.")
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


class TiposParaSolicitarView(APIView):
    """Los tipos de proyecto que se pueden solicitar: toda persona con sesión."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        tipos = TipoProyecto.objects.filter(activo=True).prefetch_related(
            "campos", "pasos__aprobadores"
        )
        return Response(TipoParaSolicitarSerializer(tipos, many=True).data)


class PlantillaParaSolicitarView(APIView):
    """La plantilla de un tipo activo, para descargarla y llenarla."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        tipo = TipoProyecto.objects.filter(pk=pk, activo=True).first()
        if tipo is None or not tipo.plantilla:
            raise Http404("No se encontró la plantilla.")
        return _descargar(tipo.plantilla, tipo.plantilla_nombre, tipo.plantilla_tipo)


class _Comentario(serializers.Serializer):
    comentario = serializers.CharField(allow_blank=True, default="")


class SolicitudViewSet(viewsets.GenericViewSet):
    """Las solicitudes de proyecto: las mías, las que tengo por atender y, con
    `proyectos.ver_todas`, todas las de la empresa."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return SolicitudProyecto.objects.select_related(
            "tipo_proyecto", "solicitante", "paso_actual"
        ).prefetch_related("pendiente_de")

    def list(self, request):
        vista = request.query_params.get("vista", "mias")
        queryset = self.get_queryset()
        if vista == "por_atender":
            queryset = queryset.filter(
                estado=SolicitudProyecto.Estado.PENDIENTE, pendiente_de=request.user
            )
        elif vista == "todas":
            if not user_has_permission(request.user, "proyectos.ver_todas"):
                return Response(
                    {"detail": "No tiene el permiso requerido: proyectos.ver_todas."},
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
            datos["tipo_proyecto"],
            titulo=datos["titulo"],
            respuestas=services.leer_respuestas(datos.get("respuestas")),
            archivo=datos["archivo"],
            tipo_archivo=getattr(entrada, "_tipo", ""),
        )
        record_audit_event(
            actor=request.user,
            action="proyectos.solicitud.creada",
            target=solicitud,
            module=MODULO,
            new_values={
                "numero": solicitud.numero,
                "tipo": solicitud.tipo_proyecto.nombre,
                "titulo": solicitud.titulo,
            },
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
                "por_atender": SolicitudProyecto.objects.filter(
                    pendiente_de=request.user, estado=SolicitudProyecto.Estado.PENDIENTE
                ).count()
            }
        )

    def _accion(self, request, pk, hacer, nombre):
        solicitud = self._solicitud(request, pk)
        entrada = _Comentario(data=request.data)
        entrada.is_valid(raise_exception=True)
        hacer(solicitud, request.user, entrada.validated_data["comentario"])
        record_audit_event(
            actor=request.user,
            action=f"proyectos.solicitud.{nombre}",
            target=solicitud,
            module=MODULO,
            new_values={"numero": solicitud.numero, "estado": solicitud.estado},
            context=get_request_context(request),
        )
        return self._detalle(request, solicitud)

    @action(detail=True, methods=["post"])
    def aprobar(self, request, pk=None):
        return self._accion(request, pk, services.aprobar, "aprobada")

    @action(detail=True, methods=["post"])
    def rechazar(self, request, pk=None):
        return self._accion(request, pk, services.rechazar, "rechazada")

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        return self._accion(request, pk, services.cancelar, "cancelada")

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
    def archivo(self, request, pk=None):
        """La plantilla llena que cargó quien solicita."""
        solicitud = self._solicitud(request, pk)
        return _descargar(solicitud.archivo, solicitud.archivo_nombre, solicitud.archivo_tipo)
