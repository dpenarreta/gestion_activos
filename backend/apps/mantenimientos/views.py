from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context

from .models import CatalogoComponente, Mantenimiento
from .permissions import CatalogoComponentesPermission, MantenimientosPermission
from .serializers import (
    CatalogoComponenteSerializer,
    MantenimientoSerializer,
    MantenimientoWriteSerializer,
)
from .services import MantenimientoService

MODULO = "mantenimientos"


class CatalogoComponenteViewSet(viewsets.ModelViewSet):
    """Catálogo de repuestos. Sin `DELETE`: los consumos históricos lo
    referencian con `PROTECT`."""

    permission_classes = [IsAuthenticated, CatalogoComponentesPermission]
    serializer_class = CatalogoComponenteSerializer
    pagination_class = DefaultPagination
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        queryset = CatalogoComponente.objects.order_by("nombre")
        params = self.request.query_params
        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(nombre__icontains=busqueda) | Q(codigo__icontains=busqueda)
            )
        critico = params.get("es_critico")
        if critico in {"true", "false"}:
            queryset = queryset.filter(es_critico=critico == "true")
        return queryset

    def perform_create(self, serializer):
        componente = serializer.save()
        record_audit_event(
            actor=self.request.user,
            action="componente.created",
            target=componente,
            module=MODULO,
            new_values=serializer.data,
            context=get_request_context(self.request),
        )

    def perform_update(self, serializer):
        anterior_critico = serializer.instance.es_critico
        componente = serializer.save()
        if anterior_critico != componente.es_critico:
            # Cambiar la criticidad no reescribe el pasado: los consumos ya
            # registrados conservan su propio `era_critico` (ver el docstring
            # de apps.mantenimientos.models). Se audita porque altera cómo se
            # contarán los reemplazos futuros contra el umbral de RF-06.
            record_audit_event(
                actor=self.request.user,
                action="componente.criticidad_changed",
                target=componente,
                module=MODULO,
                previous_values={"es_critico": anterior_critico},
                new_values={"es_critico": componente.es_critico},
                context=get_request_context(self.request),
            )


class MantenimientoViewSet(viewsets.ModelViewSet):
    """Bitácora de intervenciones (RF-04)."""

    permission_classes = [IsAuthenticated, MantenimientosPermission]
    pagination_class = DefaultPagination

    def get_queryset(self):
        queryset = (
            Mantenimiento.objects.select_related("activo", "registrado_por")
            .prefetch_related("componentes__componente")
            .order_by("-fecha_intervencion", "-created_at")
        )
        params = self.request.query_params

        activo = params.get("activo")
        if activo and activo.isdigit():
            queryset = queryset.filter(activo_id=int(activo))

        codigo = params.get("codigo_barras")
        if codigo:
            queryset = queryset.filter(activo__codigo_barras__iexact=codigo.strip())

        tipo = params.get("tipo")
        if tipo:
            queryset = queryset.filter(tipo=tipo)

        busqueda = params.get("q")
        if busqueda:
            queryset = queryset.filter(
                Q(responsable__icontains=busqueda)
                | Q(descripcion__icontains=busqueda)
                | Q(diagnostico__icontains=busqueda)
                | Q(activo__codigo_barras__icontains=busqueda)
            )

        desde = params.get("desde")
        if desde:
            queryset = queryset.filter(fecha_intervencion__gte=desde)
        hasta = params.get("hasta")
        if hasta:
            queryset = queryset.filter(fecha_intervencion__lte=hasta)

        return queryset

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return MantenimientoWriteSerializer
        return MantenimientoSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = dict(serializer.validated_data)
        mantenimiento = MantenimientoService.registrar(
            actor=request.user,
            activo=datos.pop("activo"),
            componentes=datos.pop("componentes", []),
            context=get_request_context(request),
            **datos,
        )
        return Response(MantenimientoSerializer(mantenimiento).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instancia = self.get_object()
        serializer = self.get_serializer(
            instancia, data=request.data, partial=kwargs.pop("partial", False)
        )
        serializer.is_valid(raise_exception=True)
        datos = dict(serializer.validated_data)
        datos.pop("activo", None)  # Un mantenimiento no cambia de activo.
        mantenimiento = MantenimientoService.actualizar(
            actor=request.user,
            mantenimiento=instancia,
            componentes=datos.pop("componentes", None),
            context=get_request_context(request),
            **datos,
        )
        return Response(MantenimientoSerializer(mantenimiento).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        MantenimientoService.eliminar(
            actor=request.user,
            mantenimiento=self.get_object(),
            context=get_request_context(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
