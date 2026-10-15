import datetime

from django.db.models import Case, IntegerField, Q, Value, When
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.audit import record_audit_event
from apps.core.pagination import DefaultPagination
from apps.core.request_meta import get_request_context
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.servicios import empresas_de
from apps.organizacion.models import Sede
from apps.users.models import User

from . import estados, servicios
from .acceso import capacidades_en, empresa_de_la_matriz, exigir, visibles
from .models import (
    Area,
    EntidadControl,
    Etapa,
    Obligacion,
    Periodicidad,
    Periodo,
    Prioridad,
    Tipo,
)
from .permissions import CatalogosPermission
from .serializers import (
    AreaSerializer,
    EntidadControlSerializer,
    EventoSerializer,
    ObligacionAltaSerializer,
    ObligacionSerializer,
    PeriodoDetalleSerializer,
    PeriodoListaSerializer,
    SeguimientoSerializer,
    persona,
)

MODULO = "matriz"

# --- Empresas de la Matriz (fase 1) --------------------------------------------


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mis_empresas(request):
    """Las empresas donde la cuenta puede entrar a la Matriz, con su rol y lo
    que puede hacer en cada una (§14.1, `companies/mine/`).

    Solo las que dan alguna capacidad: una membresía sin rol de la Matriz deja
    entrar al inventario, pero no a este módulo.
    """
    membresias = {m.empresa_id: m for m in request.user.membresias.prefetch_related("roles")}
    resultado = []
    for empresa in empresas_de(request.user):
        capacidades = capacidades_en(request.user, empresa)
        if not capacidades:
            continue
        membresia = membresias.get(empresa.id)
        roles = [
            rol.name
            for rol in (membresia.roles.all() if membresia else [])
            if rol.permissions.filter(codename__startswith="matriz.").exists()
        ]
        if not roles and request.user.is_superuser:
            roles = ["Superusuario"]
        resultado.append(
            {
                "id": empresa.id,
                "nombre": empresa.nombre,
                "codigo": empresa.codigo,
                "color": empresa.color,
                "zona_horaria": empresa.zona_horaria,
                "roles": roles,
                "capacidades": capacidades,
            }
        )
    return Response({"empresas": resultado})


# --- Catálogos compartidos (fase 1) --------------------------------------------


class _CatalogoViewSet(viewsets.ModelViewSet):
    """Áreas y entidades de control (§14.6).

    Se pueden eliminar —son catálogos, no registros con historia—, salvo que
    alguna obligación las use: la relación es `PROTECT` y el intento responde
    409 en vez de dejar obligaciones huérfanas.
    """

    permission_classes = [IsAuthenticated, CatalogosPermission]
    pagination_class = None
    accion = ""

    def _auditar(self, accion, instancia, anteriores=None, nuevos=None, **objetivo):
        record_audit_event(
            actor=self.request.user,
            action=f"{self.accion}.{accion}",
            target=instancia,
            module=MODULO,
            previous_values=anteriores,
            new_values=nuevos,
            context=get_request_context(self.request),
            **objetivo,
        )

    def perform_create(self, serializer):
        instancia = serializer.save()
        self._auditar("created", instancia, nuevos=serializer.data)

    def perform_update(self, serializer):
        anteriores = self.get_serializer(serializer.instance).data
        instancia = serializer.save()
        self._auditar("updated", instancia, anteriores=anteriores, nuevos=serializer.data)

    def destroy(self, request, *args, **kwargs):
        instancia = self.get_object()
        datos = self.get_serializer(instancia).data
        tipo, ident = instancia.__class__.__name__.lower(), instancia.pk
        try:
            instancia.delete()
        except ProtectedError:
            return Response(
                {
                    "error": {
                        "code": "en_uso",
                        "message": "No se puede eliminar: hay obligaciones que lo usan.",
                        "details": None,
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        self._auditar("deleted", None, anteriores=datos, target_type=tipo, target_id=ident)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AreaViewSet(_CatalogoViewSet):
    queryset = Area.objects.all()
    serializer_class = AreaSerializer
    accion = "matriz.area"


class EntidadControlViewSet(_CatalogoViewSet):
    queryset = EntidadControl.objects.all()
    serializer_class = EntidadControlSerializer
    accion = "matriz.entidad_control"


# --- Lo que necesitan los formularios (fase 2) ---------------------------------


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def personas(request):
    """Quienes trabajan en la empresa activa, para elegir responsables (§14.1)."""
    empresa, _ = empresa_de_la_matriz(request)
    if Empresa.objects.filter(activa=True).count() == 1:
        cuentas = User.objects.filter(is_active=True)
    else:
        ids = MembresiaEmpresa.objects.filter(empresa=empresa).values_list("usuario_id", flat=True)
        cuentas = User.objects.filter(is_active=True, id__in=ids)
    return Response([persona(c) for c in cuentas.order_by("first_name", "last_name", "username")])


def _opciones(choices):
    return [{"valor": valor, "nombre": nombre} for valor, nombre in choices]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def catalogos(request):
    """Todo lo que eligen los formularios de la Matriz, en una sola petición."""
    empresa_de_la_matriz(request)
    return Response(
        {
            "areas": AreaSerializer(Area.objects.all(), many=True).data,
            "entidades": EntidadControlSerializer(EntidadControl.objects.all(), many=True).data,
            "sedes": [{"id": s.id, "nombre": s.nombre} for s in Sede.objects.order_by("nombre")],
            "tipos": _opciones(Tipo.choices),
            "periodicidades": _opciones(Periodicidad.choices),
            "prioridades": _opciones(Prioridad.choices),
            "etapas": _opciones(Etapa.choices),
        }
    )


# --- Resumen (§14.2, §15.2) ------------------------------------------------------


def _consulta_base():
    return Periodo.objects.select_related(
        "obligacion__area", "obligacion__entidad", "responsable", "empresa"
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def resumen(request):
    """Los indicadores de la empresa y las dos listas del tablero."""
    empresa, capacidades = empresa_de_la_matriz(request)
    ahora = timezone.now()
    periodos = visibles(_consulta_base(), request.user, capacidades)

    zona = estados.zona_de(empresa)
    hoy = ahora.astimezone(zona).date()
    fin_de_hoy = datetime.datetime.combine(hoy + datetime.timedelta(days=1), datetime.time(), zona)
    en_siete = datetime.datetime.combine(hoy + datetime.timedelta(days=8), datetime.time(), zona)

    abiertos = periodos.filter(cerrado=False)
    incumplidos = abiertos.filter(vence_en__lt=ahora)
    en_progreso = abiertos.filter(vence_en__gte=ahora)
    cerrados = list(periodos.filter(cerrado=True))
    tarde = sum(1 for p in cerrados if estados.estado(p, ahora)["is_late"])

    contexto = {"ahora": ahora}
    proximos = abiertos.order_by("vence_en")[:6]
    recientes = periodos.filter(cerrado=True).order_by("-validado_en")[:5]
    return Response(
        {
            "counts": {
                "overdue": incumplidos.count(),
                "in_progress": en_progreso.count(),
                # En progreso y vence dentro de los próximos 7 días.
                "due_soon": en_progreso.filter(vence_en__lt=en_siete).count(),
                "done": len(cerrados),
                "done_on_time": len(cerrados) - tarde,
                "done_late": tarde,
                # Lo que pide atención hoy: lo incumplido y lo que vence hoy.
                "attention": incumplidos.count()
                + en_progreso.filter(vence_en__lt=fin_de_hoy).count(),
            },
            "upcoming": PeriodoListaSerializer(proximos, many=True, context=contexto).data,
            "recent_closures": PeriodoListaSerializer(recientes, many=True, context=contexto).data,
        }
    )


# --- La matriz (§14.2, §15.3) ----------------------------------------------------

ORDENES = {
    "due": ["vence_en"],
    "name": ["obligacion__nombre"],
    "area": ["obligacion__area__nombre"],
    "entity": ["obligacion__entidad__nombre"],
    "responsible": ["responsable__first_name", "responsable__last_name"],
    "code": ["codigo"],
    "priority": ["orden_prioridad"],
}


def _filtrar(consulta, params, empresa, ahora):
    q = (params.get("q") or "").strip()
    if q:
        consulta = consulta.filter(
            Q(obligacion__nombre__icontains=q)
            | Q(codigo__icontains=q)
            | Q(etiqueta__icontains=q)
            | Q(responsable__first_name__icontains=q)
            | Q(responsable__last_name__icontains=q)
            | Q(responsable__username__icontains=q)
            | Q(obligacion__entidad__nombre__icontains=q)
            | Q(obligacion__entidad__codigo__icontains=q)
            | Q(obligacion__area__nombre__icontains=q)
            | Q(obligacion__area__codigo__icontains=q)
        )
    for parametro, campo in (
        ("area", "obligacion__area_id"),
        ("entity", "obligacion__entidad_id"),
        ("responsible", "responsable_id"),
        ("obligation", "obligacion_id"),
        ("priority", "prioridad"),
        ("stage", "etapa"),
    ):
        valor = params.get(parametro)
        if valor:
            consulta = consulta.filter(**{campo: valor})

    grupo = params.get("status")
    if grupo:
        consulta = consulta.filter(estados.filtro_de_grupo(grupo, ahora))

    zona = estados.zona_de(empresa)
    if params.get("due_today") == "true":
        hoy = ahora.astimezone(zona).date()
        consulta = consulta.filter(
            cerrado=False,
            vence_en__gte=datetime.datetime.combine(hoy, datetime.time(), zona),
            vence_en__lt=datetime.datetime.combine(
                hoy + datetime.timedelta(days=1), datetime.time(), zona
            ),
        )
    for parametro, operador, sumar in (("due_from", "gte", 0), ("due_to", "lt", 1)):
        valor = params.get(parametro)
        if valor:
            try:
                dia = datetime.date.fromisoformat(valor) + datetime.timedelta(days=sumar)
            except ValueError:
                raise ValidationError({parametro: "Use una fecha AAAA-MM-DD."}) from None
            consulta = consulta.filter(
                **{f"vence_en__{operador}": datetime.datetime.combine(dia, datetime.time(), zona)}
            )
    return consulta


def _ordenar(consulta, orden, ahora):
    consulta = consulta.annotate(
        orden_grupo=Case(
            When(cerrado=True, then=Value(2)),
            When(vence_en__lt=ahora, then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        ),
        orden_prioridad=Case(
            When(prioridad=Prioridad.ALTA, then=Value(0)),
            When(prioridad=Prioridad.MEDIA, then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        ),
    )
    descendente = orden.startswith("-")
    clave = orden.lstrip("-")
    if clave in ORDENES:
        campos = [f"-{c}" if descendente else c for c in ORDENES[clave]]
        return consulta.order_by(*campos, "vence_en", "id")
    # Por urgencia (§9): incumplidos, en progreso, finalizados; dentro de cada
    # grupo, el vencimiento más atrasado o más próximo primero.
    return consulta.order_by("orden_grupo", "vence_en", "id")


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def periodos(request):
    """La matriz paginada, con filtros y orden (§14.2)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    ahora = timezone.now()
    consulta = visibles(_consulta_base(), request.user, capacidades)
    consulta = _filtrar(consulta, request.query_params, empresa, ahora)
    consulta = _ordenar(consulta, request.query_params.get("sort", "urgency"), ahora)

    paginador = DefaultPagination()
    pagina = paginador.paginate_queryset(consulta, request)
    datos = PeriodoListaSerializer(pagina, many=True, context={"ahora": ahora}).data
    return paginador.get_paginated_response(datos)


# --- Detalle del período ---------------------------------------------------------


def _periodo_visible(request, pk):
    """El período si se puede ver; si no, 404 —nunca 403— (§8.4)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    periodo = get_object_or_404(
        visibles(
            _consulta_base().select_related(
                "sede", "suplente", "supervisor", "aprobador", "validado_por"
            ),
            request.user,
            capacidades,
        ),
        pk=pk,
    )
    return periodo, capacidades


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def periodo(request, pk):
    """El detalle del período; con `PATCH`, el seguimiento (§14.3)."""
    actual, capacidades = _periodo_visible(request, pk)
    contexto = {"request": request, "capacidades": capacidades, "empresa": actual.empresa}

    if request.method == "PATCH":
        exigir(request, "matriz.editar", capacidades, actual)
        if actual.cerrado:
            raise ValidationError({"detail": "Un período cerrado no se puede editar."})
        entrada = SeguimientoSerializer(data=request.data, partial=True, context=contexto)
        entrada.is_valid(raise_exception=True)
        if "responsable" in request.data and entrada.validated_data.get("responsable") is None:
            raise ValidationError({"responsable": "El responsable es obligatorio."})
        servicios.editar_seguimiento(
            periodo=actual,
            actor=request.user,
            cambios=entrada.validated_data,
            contexto=get_request_context(request),
        )
        actual, capacidades = _periodo_visible(request, pk)

    return Response(PeriodoDetalleSerializer(actual, context=contexto).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def historial(request, pk):
    """El historial del período, del más reciente al más antiguo (§14.3)."""
    actual, _ = _periodo_visible(request, pk)
    return Response(EventoSerializer(actual.eventos.select_related("actor"), many=True).data)


# --- Obligaciones -----------------------------------------------------------------


def _puede_crear_en(request, area, capacidades):
    """Con `crear`, sin `ver_todas` y con áreas en la membresía, solo crea en
    esas áreas (§8.7)."""
    if "matriz.ver_todas" in capacidades or request.user.is_superuser:
        return True
    from apps.empresas.contexto import empresa_actual

    membresia = MembresiaEmpresa.objects.filter(
        usuario=request.user, empresa=empresa_actual()
    ).first()
    if membresia is None:
        return True
    areas = list(membresia.areas_matriz.values_list("id", flat=True))
    return not areas or area.id in areas


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def obligaciones(request):
    """Crea la obligación y su primer período (§11.1)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    exigir(request, "matriz.crear", capacidades)
    entrada = ObligacionAltaSerializer(
        data=request.data, context={"request": request, "empresa": empresa}
    )
    entrada.is_valid(raise_exception=True)
    if not _puede_crear_en(request, entrada.validated_data["area"], capacidades):
        raise ValidationError({"area": "Solo puede crear obligaciones de sus áreas."})
    plantilla, primero = entrada.separar()
    _, nuevo = servicios.crear_obligacion(
        empresa=empresa,
        actor=request.user,
        plantilla=plantilla,
        periodo=primero,
        contexto=get_request_context(request),
    )
    nuevo = _consulta_base().get(pk=nuevo.pk)
    datos = PeriodoDetalleSerializer(
        nuevo, context={"request": request, "capacidades": capacidades}
    ).data
    return Response(datos, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def obligacion(request, pk):
    """La plantilla; con `PATCH`, su edición (§11.2). No toca los períodos."""
    _, capacidades = empresa_de_la_matriz(request)
    actual = get_object_or_404(Obligacion.objects.select_related("area", "entidad"), pk=pk)
    if request.method == "PATCH":
        exigir(request, "matriz.editar", capacidades)
        anteriores = ObligacionSerializer(actual).data
        entrada = ObligacionSerializer(actual, data=request.data, partial=True)
        entrada.is_valid(raise_exception=True)
        actual = entrada.save()
        cambios = {k: v for k, v in entrada.data.items() if anteriores.get(k) != v}
        if cambios:
            record_audit_event(
                actor=request.user,
                action="obligation.updated",
                target=actual,
                module=MODULO,
                previous_values={k: anteriores.get(k) for k in cambios},
                new_values=cambios,
                context=get_request_context(request),
            )
    return Response(ObligacionSerializer(actual).data)
