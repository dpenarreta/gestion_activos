from urllib.parse import quote

from django.contrib.auth.models import Group
from django.db.models import Count, IntegerField, OuterRef, Prefetch, Subquery
from django.db.models.functions import Coalesce
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
from apps.permissions.permissions import HasActionPermission

from . import services
from .categorias import PorCategoriaMixin
from .models import AprobadorPasoProyecto, SolicitudProyecto
from .serializers import (
    DetalleSolicitudSerializer,
    NuevaSolicitudSerializer,
    PlantillaSerializer,
    SolicitudSerializer,
    TipoParaSolicitarSerializer,
    TipoProyectoSerializer,
)

# Todas las vistas aceptan `?categoria=proyecto|proceso` (US-008, 12/11/2026;
# ver `categorias.PorCategoriaMixin`): sin él vale `proyecto`, con otro valor
# 400. Lo de otra categoría responde 404, como lo que no existe. El módulo de
# la auditoría y el prefijo de sus acciones son los de la categoría
# («proyectos» o «procesos»).


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


class ConfigurarPermission(HasActionPermission):
    """`proyectos.configurar` o `procesos.configurar`, según la categoría
    pedida: uno no sirve para la otra (US-008). Se evalúa después de
    `IsAuthenticated`, así que sin sesión sigue siendo 401; con una categoría
    inválida, 400."""

    def get_required_permission(self, request, view) -> str:
        return view.datos_categoria.permiso_configurar


class TipoProyectoViewSet(PorCategoriaMixin, viewsets.ModelViewSet):
    """Los tipos de proyecto o de proceso, para configurarlos (pide el
    `*.configurar` de la categoría): su formulario, sus pasos y su plantilla.
    Un tipo con solicitudes no se borra: se desactiva. La categoría de un tipo
    nuevo es la de `?categoria=` y no cambia después."""

    permission_classes = [IsAuthenticated, ConfigurarPermission]
    serializer_class = TipoProyectoSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        """Todo lo que pinta el serializer viene en un número fijo de consultas,
        tenga los tipos que tenga (QA-TECH, US-008): cuántas solicitudes tiene
        cada tipo (subconsulta, con el filtro por empresa del gestor), sus
        campos, sus pasos con quién decide y las solicitudes en curso."""
        cuantas = (
            SolicitudProyecto.objects.filter(tipo_proyecto=OuterRef("pk"))
            .order_by()
            .values("tipo_proyecto")
            .annotate(total=Count("pk"))
            .values("total")
        )
        return (
            self.tipos()
            .annotate(num_solicitudes=Coalesce(Subquery(cuantas, output_field=IntegerField()), 0))
            .prefetch_related(
                "campos",
                "pasos",
                Prefetch(
                    "pasos__aprobadores",
                    queryset=AprobadorPasoProyecto.objects.select_related(
                        "usuario", "rol", "cargo"
                    ),
                ),
                Prefetch(
                    "solicitudes",
                    queryset=SolicitudProyecto.objects.filter(
                        estado=SolicitudProyecto.Estado.PENDIENTE
                    ).only("id", "tipo_proyecto_id", "paso_actual_id"),
                    to_attr="solicitudes_en_curso",
                ),
            )
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "categoria": self.categoria}

    def _auditar(self, accion, tipo, **valores):
        modulo = self.datos_categoria.modulo
        record_audit_event(
            actor=self.request.user,
            action=f"{modulo}.tipo.{accion}",
            target=tipo,
            module=modulo,
            new_values={"nombre": tipo.nombre, "categoria": tipo.categoria, **valores},
            context=get_request_context(self.request),
        )

    def perform_create(self, serializer):
        self._auditar("creado", serializer.save(categoria=self.categoria))

    def perform_update(self, serializer):
        self._auditar("editado", serializer.save())

    def destroy(self, request, *args, **kwargs):
        tipo = self.get_object()
        if tipo.solicitudes.exists():
            return Response(
                {
                    "detail": f"Este tipo de {self.datos_categoria.singular} ya tiene "
                    "solicitudes: desactívelo en lugar de borrarlo."
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
                raise Http404(
                    f"Este tipo de {self.datos_categoria.singular} todavía no tiene plantilla."
                )
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


class OpcionesView(PorCategoriaMixin, APIView):
    """Personas, roles y cargos para elegir quién decide un paso o a quién se
    escala. La ve, en su categoría, quien configura, quien ve todas o quien
    tiene alguna solicitud pendiente de decidir."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        usuario = request.user
        datos = self.datos_categoria
        puede = (
            user_has_permission(usuario, datos.permiso_configurar)
            or user_has_permission(usuario, datos.permiso_ver_todas)
            or self.de_la_categoria(
                SolicitudProyecto.objects.filter(
                    estado=SolicitudProyecto.Estado.PENDIENTE, pendiente_de=usuario
                )
            ).exists()
        )
        if not puede:
            raise PermissionDenied(f"No tiene el permiso requerido: {datos.permiso_configurar}.")
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


class TiposParaSolicitarView(PorCategoriaMixin, APIView):
    """Los tipos de la categoría que se pueden solicitar: toda persona con
    sesión."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        tipos = self.tipos().filter(activo=True).prefetch_related("campos", "pasos__aprobadores")
        return Response(TipoParaSolicitarSerializer(tipos, many=True).data)


class PlantillaParaSolicitarView(PorCategoriaMixin, APIView):
    """La plantilla de un tipo activo de la categoría, para descargarla y
    llenarla."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        tipo = self.tipos().filter(pk=pk, activo=True).first()
        if tipo is None or not tipo.plantilla:
            raise Http404("No se encontró la plantilla.")
        return _descargar(tipo.plantilla, tipo.plantilla_nombre, tipo.plantilla_tipo)


class _Comentario(serializers.Serializer):
    comentario = serializers.CharField(allow_blank=True, default="")


class SolicitarPermission(HasActionPermission):
    """Pedir (crear) una solicitud exige el permiso de la categoría, si tiene:
    `procesos.solicitar` para procesos; proyectos no pide nada (US-008). Ver
    las propias, atender, decidir y el resumen no lo exigen. Se evalúa
    después de `IsAuthenticated` y audita el intento denegado."""

    def get_required_permission(self, request, view):
        if getattr(view, "action", None) != "create":
            return None
        return view.datos_categoria.permiso_solicitar


class SolicitudViewSet(PorCategoriaMixin, viewsets.GenericViewSet):
    """Las solicitudes de la categoría: las mías, las que tengo por atender y,
    con el `*.ver_todas` de la categoría, todas las de la empresa. Una de otra
    categoría responde 404 en todas las acciones."""

    permission_classes = [IsAuthenticated, SolicitarPermission]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return self.de_la_categoria(
            SolicitudProyecto.objects.select_related(
                "tipo_proyecto", "solicitante", "paso_actual"
            ).prefetch_related("pendiente_de")
        )

    def _auditar(self, request, accion, solicitud, **valores):
        modulo = self.datos_categoria.modulo
        record_audit_event(
            actor=request.user,
            action=f"{modulo}.solicitud.{accion}",
            target=solicitud,
            module=modulo,
            new_values={"numero": solicitud.numero, **valores},
            context=get_request_context(request),
        )

    def list(self, request):
        vista = request.query_params.get("vista", "mias")
        queryset = self.get_queryset()
        if vista == "por_atender":
            queryset = queryset.filter(
                estado=SolicitudProyecto.Estado.PENDIENTE, pendiente_de=request.user
            )
        elif vista == "todas":
            permiso = self.datos_categoria.permiso_ver_todas
            if not user_has_permission(request.user, permiso):
                return Response(
                    {"detail": f"No tiene el permiso requerido: {permiso}."},
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
        # El tipo tiene que ser de la categoría pedida: uno de la otra responde
        # como uno que no existe.
        entrada = NuevaSolicitudSerializer(
            data=request.data, context={"request": request, "categoria": self.categoria}
        )
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
        self._auditar(
            request,
            "creada",
            solicitud,
            tipo=solicitud.tipo_proyecto.nombre,
            titulo=solicitud.titulo,
        )
        return Response(
            DetalleSolicitudSerializer(solicitud, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        """Lo que tengo por atender en la categoría pedida (la insignia del
        menú: `proyectos_por_atender` o `procesos_por_atender`)."""
        return Response(
            {
                "por_atender": self.de_la_categoria(
                    SolicitudProyecto.objects.filter(
                        pendiente_de=request.user, estado=SolicitudProyecto.Estado.PENDIENTE
                    )
                ).count()
            }
        )

    def _accion(self, request, pk, hacer, nombre):
        solicitud = self._solicitud(request, pk)
        entrada = _Comentario(data=request.data)
        entrada.is_valid(raise_exception=True)
        hacer(solicitud, request.user, entrada.validated_data["comentario"])
        self._auditar(request, nombre, solicitud, estado=solicitud.estado)
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
