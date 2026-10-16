"""La API de órdenes de trabajo (mantenimiento de sedes)."""

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as ErrorDeModelo
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.organizacion.models import Proveedor, Sede
from apps.permissions.permissions import HasActionPermission
from apps.reportes import render_excel, render_pdf

from . import estadisticas, exportacion, services
from .models import ManoDeObraOrden, MaterialOrden, OrdenTrabajo
from .serializers import (
    AsignacionSerializer,
    CambioDeEstadoSerializer,
    ManoDeObraSerializer,
    MaterialSerializer,
    MovimientoSerializer,
    OrdenDetalleSerializer,
    OrdenEscrituraSerializer,
    OrdenListaSerializer,
)

MODULO = "ordenes"
User = get_user_model()

FORMATOS = {
    "xlsx": (
        render_excel.exportar,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
    ),
    "pdf": (render_pdf.exportar, "application/pdf", "pdf"),
}


class OrdenesPermission(HasActionPermission):
    """La puerta de cada acción. Quién puede mover **qué orden** lo decide
    `services`, con la orden delante."""

    def get_required_permission(self, request, view) -> str:
        accion = getattr(view, "action", None)
        if accion in {"reportes", "exportar"}:
            return "ordenes.reportes"
        if accion == "create":
            return "ordenes.crear"
        if request.method in SAFE_METHODS:
            return "ordenes.ver"
        return "ordenes.ver"


def _errores(error):
    return error.message_dict if hasattr(error, "message_dict") else error.messages


class OrdenViewSet(viewsets.ModelViewSet):
    """Órdenes de trabajo. Sin `DELETE`: una orden no se borra, se cierra."""

    permission_classes = [IsAuthenticated, OrdenesPermission]
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = services.visibles(self.request.user).select_related(
            "sede", "solicitante", "tecnico", "proveedor"
        )
        queryset = queryset.prefetch_related("materiales", "mano_de_obra")
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("movimientos__actor", "sede__responsables")
        if self.action != "list":
            return queryset

        params = self.request.query_params
        queryset = estadisticas.filtrar(queryset, params)
        estado = params.get("estado")
        if estado in OrdenTrabajo.Estado.values:
            queryset = queryset.filter(estado=estado)
        elif params.get("abiertas") == "true":
            queryset = queryset.exclude(estado=OrdenTrabajo.Estado.CERRADA)
        prioridad = params.get("prioridad")
        if prioridad in OrdenTrabajo.Prioridad.values:
            queryset = queryset.filter(prioridad=prioridad)
        ambito = params.get("ambito")
        usuario = self.request.user
        if ambito == "mias":
            queryset = queryset.filter(solicitante=usuario)
        elif ambito == "asignadas":
            queryset = queryset.filter(tecnico=usuario)
        busqueda = (params.get("q") or "").strip()
        if busqueda:
            filtro = (
                Q(titulo__icontains=busqueda)
                | Q(sede__nombre__icontains=busqueda)
                | Q(sede__ciudad__icontains=busqueda)
                | Q(tecnico__first_name__icontains=busqueda)
                | Q(tecnico__last_name__icontains=busqueda)
            )
            partes = busqueda.upper().replace("OT-", "").split("-")
            if partes[-1].isdigit():
                filtro |= Q(secuencia=int(partes[-1]))
            queryset = queryset.filter(filtro)
        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "partial_update"}:
            return OrdenEscrituraSerializer
        if self.action == "retrieve":
            return OrdenDetalleSerializer
        return OrdenListaSerializer

    def _detalle(self, orden):
        orden = self.get_queryset().prefetch_related("movimientos__actor").get(pk=orden.pk)
        return OrdenDetalleSerializer(orden, context=self.get_serializer_context()).data

    def _auditar(self, accion, orden, nuevos, previos=None):
        record_audit_event(
            actor=self.request.user,
            action=accion,
            target_type="ordentrabajo",
            target_id=orden.numero,
            module=MODULO,
            previous_values=previos,
            new_values=nuevos,
            context=get_request_context(self.request),
        )

    def create(self, request, *args, **kwargs):
        entrada = self.get_serializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            orden = services.OrdenService.crear(actor=request.user, **entrada.validated_data)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar(
            "orden.created",
            orden,
            {
                "sede": orden.sede.nombre,
                "categoria": orden.categoria,
                "prioridad": orden.prioridad,
                "titulo": orden.titulo,
            },
        )
        return Response(self._detalle(orden), status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        orden = self.get_object()
        if not services.puede_editarla(request.user, orden):
            raise PermissionDenied(
                "La orden la corrige quien coordina, o quien la pidió mientras nadie la haya tomado."
            )
        entrada = self.get_serializer(orden, data=request.data, partial=True)
        entrada.is_valid(raise_exception=True)
        cambio = services.OrdenService.corregir(
            orden=orden, actor=request.user, **entrada.validated_data
        )
        if cambio["nuevos"]:
            # El teléfono es un dato personal: la bitácora dice que cambió, no a qué.
            for lado in ("previos", "nuevos"):
                if "telefono_contacto" in cambio[lado]:
                    cambio[lado]["telefono_contacto"] = "(dato personal)"
            self._auditar("orden.updated", orden, cambio["nuevos"], cambio["previos"])
        return Response(self._detalle(orden))

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Una orden no se borra: se cierra, y queda en el historial."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["post"])
    def asignar(self, request, pk=None):
        orden = self.get_object()
        entrada = AsignacionSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data
        if datos["tecnico"].pk not in set(_tecnicos().values_list("pk", flat=True)):
            raise serializers.ValidationError(
                {"tecnico": "Esa persona no puede ejecutar órdenes en esta empresa."}
            )
        previos = {"tecnico": orden.tecnico_id, "estado": orden.estado}
        try:
            orden = services.OrdenService.asignar(
                orden=orden,
                actor=request.user,
                tecnico=datos["tecnico"],
                proveedor=datos.get("proveedor"),
                fecha_programada=datos.get("fecha_programada"),
                nota=datos.get("nota", ""),
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar(
            "orden.asignada",
            orden,
            {"tecnico": orden.tecnico_id, "estado": orden.estado},
            previos,
        )
        return Response(self._detalle(orden))

    @action(detail=True, methods=["post"], url_path="cambiar-estado")
    def cambiar_estado(self, request, pk=None):
        orden = self.get_object()
        entrada = CambioDeEstadoSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        anterior = orden.estado
        try:
            orden = services.OrdenService.cambiar_estado(
                orden=orden, actor=request.user, **entrada.validated_data
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar(
            "orden.estado_changed",
            orden,
            {"estado": orden.estado, "con_observaciones": orden.con_observaciones},
            {"estado": anterior},
        )
        return Response(self._detalle(orden))

    @action(detail=True, methods=["post"])
    def materiales(self, request, pk=None):
        return self._registrar(request, MaterialSerializer, "registrar_material", "orden.material")

    @action(detail=True, methods=["post"], url_path="mano-de-obra")
    def mano_de_obra(self, request, pk=None):
        return self._registrar(
            request, ManoDeObraSerializer, "registrar_mano_de_obra", "orden.mano_de_obra"
        )

    def _registrar(self, request, serializer_class, metodo, accion):
        orden = self.get_object()
        entrada = serializer_class(data=request.data)
        entrada.is_valid(raise_exception=True)
        try:
            fila = getattr(services.OrdenService, metodo)(
                orden=orden, actor=request.user, **entrada.validated_data
            )
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar(accion, orden, serializer_class(fila).data)
        return Response(self._detalle(orden), status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"costos/(?P<tipo>materiales|mano-de-obra)/(?P<fila_id>\d+)",
    )
    def quitar_costo(self, request, pk=None, tipo=None, fila_id=None):
        orden = self.get_object()
        modelo = MaterialOrden if tipo == "materiales" else ManoDeObraOrden
        fila = get_object_or_404(modelo, pk=fila_id, orden=orden)
        datos = {"descripcion": fila.descripcion, "subtotal": str(fila.subtotal)}
        try:
            services.OrdenService.quitar_costo(orden=orden, actor=request.user, fila=fila)
        except ErrorDeModelo as error:
            raise serializers.ValidationError(_errores(error)) from error
        self._auditar("orden.costo_quitado", orden, {}, datos)
        return Response(self._detalle(orden))

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        """El panel: indicadores, «requieren atención» y actividad reciente."""
        base = services.visibles(request.user)
        datos = estadisticas.resumen(base)
        contexto = self.get_serializer_context()
        return Response(
            {
                "kpis": datos["kpis"],
                "atencion": OrdenListaSerializer(
                    datos["atencion"][:10], many=True, context=contexto
                ).data,
                "actividad": [
                    {
                        **MovimientoSerializer(m).data,
                        "orden": {"id": m.orden_id, "numero": m.orden.numero},
                    }
                    for m in estadisticas.actividad_reciente(base)
                ],
                "alcance": _alcance(request.user),
            }
        )

    @action(detail=False, methods=["get"])
    def reportes(self, request):
        """La reportería: indicadores y gráficos con los filtros pedidos."""
        base = estadisticas.filtrar(services.visibles(request.user), request.query_params)
        datos = estadisticas.resumen(base)
        return Response(
            {"kpis": datos["kpis"], "graficos": estadisticas.graficos(datos["ordenes"])}
        )

    @action(detail=False, methods=["get"])
    def exportar(self, request):
        formato = request.query_params.get("formato", "xlsx")
        if formato not in FORMATOS:
            raise serializers.ValidationError({"formato": "Use xlsx o pdf."})
        base = estadisticas.filtrar(services.visibles(request.user), request.query_params)
        ordenes = list(
            base.select_related("sede", "tecnico", "proveedor").prefetch_related(
                "materiales", "mano_de_obra"
            )
        )
        ver_contacto = services.tiene(request.user, "ver_contacto")
        reporte = exportacion.reporte(ver_contacto)
        resultado = exportacion.resultado(reporte, ordenes, formato)
        exportar, content_type, extension = FORMATOS[formato]
        filtros = {k: v for k, v in request.query_params.items() if k != "formato" and v}
        contenido = exportar(reporte, resultado, _describir(filtros))
        record_audit_event(
            actor=request.user,
            action="reporte.exportado",
            target_type="reporte",
            target_id=reporte.clave,
            module=MODULO,
            new_values={
                "formato": formato,
                "filas": resultado["total"],
                "truncado": resultado["truncado"],
                "contacto_completo": ver_contacto,
                "filtros": filtros,
            },
            context=get_request_context(request),
        )
        respuesta = HttpResponse(contenido, content_type=content_type)
        respuesta["Content-Disposition"] = (
            f'attachment; filename="ordenes-de-trabajo-{timezone.localdate().isoformat()}.{extension}"'
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta

    @action(detail=False, methods=["get"])
    def catalogos(self, request):
        """Lo que piden los formularios y los permisos de quien pregunta."""
        usuario = request.user
        gestor = services.es_gestor(usuario)
        datos = {
            "sedes": [
                {
                    "id": s.id,
                    "nombre": s.nombre,
                    "ciudad": s.ciudad,
                    "region": s.region,
                    "region_display": s.get_region_display(),
                    "provincia": s.provincia,
                }
                for s in Sede.objects.filter(activa=True).order_by("nombre")
            ],
            "categorias": _opciones(OrdenTrabajo.Categoria),
            "prioridades": _opciones(OrdenTrabajo.Prioridad),
            "estados": _opciones(OrdenTrabajo.Estado),
            "regiones": _opciones(Sede.Region),
            "puede": {
                "crear": services.tiene(usuario, "crear"),
                "gestionar": gestor,
                "reportes": services.tiene(usuario, "reportes"),
                "ver_todas": services.tiene(usuario, "ver_todas"),
                "ver_contacto": services.tiene(usuario, "ver_contacto"),
            },
            "alcance": _alcance(usuario),
        }
        if gestor:
            datos["tecnicos"] = [
                {"id": u.id, "nombre": u.get_full_name() or u.username} for u in _tecnicos()
            ]
            datos["proveedores"] = [
                {"id": p.id, "nombre": p.nombre}
                for p in Proveedor.objects.filter(activo=True).order_by("nombre")
            ]
        return Response(datos)


def _opciones(choices):
    return [{"valor": valor, "etiqueta": etiqueta} for valor, etiqueta in choices.choices]


def _alcance(usuario) -> str:
    if services.tiene(usuario, "ver_todas"):
        return "Todas las sedes de la empresa."
    partes = ["las órdenes que usted solicitó"]
    if services.tiene(usuario, "ejecutar"):
        partes.append("las asignadas a usted")
    sedes = list(usuario.sedes_a_cargo.values_list("nombre", flat=True))
    if sedes:
        partes.append("las de " + ", ".join(sedes))
    return "Solo " + ", ".join(partes[:-1]) + (" y " if len(partes) > 1 else "") + partes[-1] + "."


def _tecnicos():
    """Quien puede ejecutar órdenes en la empresa activa (técnicos internos y
    personal de proveedores con cuenta)."""
    permiso = "ordenes.ejecutar"
    candidatos = (
        Q(groups__permissions__codename=permiso)
        | Q(user_permissions__codename=permiso)
        | Q(is_superuser=True)
    )
    empresa = empresa_actual()
    queryset = User.objects.filter(is_active=True)
    if empresa is not None and empresa is not SIN_EMPRESA:
        candidatos |= Q(
            membresias__empresa=empresa, membresias__roles__permissions__codename=permiso
        )
        queryset = queryset.filter(membresias__empresa=empresa)
    return queryset.filter(candidatos).distinct().order_by("first_name", "last_name", "username")


def _describir(filtros: dict) -> str:
    etiquetas = {"periodo": "Periodo", "region": "Región", "categoria": "Categoría", "sede": "Sede"}
    return " · ".join(f"{etiquetas.get(k, k)}: {v}" for k, v in filtros.items())
