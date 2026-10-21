import datetime
from urllib.parse import quote

from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.db.models.deletion import ProtectedError
from django.http import FileResponse, Http404
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

from . import cierre, estados, informes, recordatorios, servicios
from .acceso import (
    capacidades_en,
    empresa_de_la_matriz,
    exigir,
    puede,
    puede_ver,
    visibles,
)
from .models import (
    Area,
    Documento,
    EntidadControl,
    EstadoDocumento,
    EstadoNotificacion,
    Etapa,
    EventoPeriodo,
    Notificacion,
    Obligacion,
    Periodicidad,
    Periodo,
    Prioridad,
    Tipo,
    TipoNotificacion,
)
from .permissions import CatalogosPermission
from .serializers import (
    AreaSerializer,
    CambioVencimientoSerializer,
    ConfiguracionRecordatoriosSerializer,
    DocumentoSerializer,
    EntidadControlSerializer,
    EventoAuditoriaSerializer,
    EventoSerializer,
    MotivoSerializer,
    NotificacionSerializer,
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
    """Quienes trabajan en la empresa activa, para elegir responsables (§14.1).
    Lista a toda la empresa: solo para quien crea, edita o gestiona miembros
    (21/10/2026; antes bastaba cualquier permiso de la Matriz)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    if not {"matriz.crear", "matriz.editar", "matriz.gestionar_miembros"} & set(capacidades):
        exigir(request, "matriz.editar", capacidades)
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
    """Todo lo que eligen los formularios de la Matriz, en una sola petición.

    Lleva también las reglas que el alta tiene que explicar antes de que el
    servidor rechace: hoy, si quien crea debe figurar en lo que crea.
    """
    empresa, capacidades = empresa_de_la_matriz(request)
    return Response(
        {
            "reglas": {
                "solo_propias": _solo_propias(empresa, capacidades),
                "yo": request.user.id,
            },
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
            if campo.endswith("_id") and not str(valor).isdigit():
                raise ValidationError({parametro: "Debe ser un identificador numérico."})
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

    if "export" in request.query_params:
        formato = _exportacion_auditada(request, empresa, capacidades, "matriz")
        return informes.exportar_matriz(
            consulta,
            empresa=empresa,
            usuario=request.user,
            formato=formato,
            filtros=_describir_filtros(request.query_params),
        )

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
        cambios = entrada.validated_data
        responsable = cambios.get("responsable", actual.responsable)
        suplente = cambios["suplente"] if "suplente" in cambios else actual.suplente
        if suplente is not None and suplente == responsable:
            raise ValidationError(
                {"suplente": "El suplente tiene que ser otra persona que el responsable."}
            )
        servicios.editar_seguimiento(
            periodo=actual,
            actor=request.user,
            cambios=entrada.validated_data,
            contexto=get_request_context(request),
        )
        # Se relee sin el filtro de visibilidad: quien cede el período a otra
        # persona deja de verlo, y responder 404 a un cambio que sí se guardó
        # le haría creer que falló. La respuesta dice que ya no es suyo.
        actual = (
            _consulta_base()
            .select_related("sede", "suplente", "supervisor", "aprobador", "validado_por")
            .get(pk=pk)
        )

    datos = PeriodoDetalleSerializer(actual, context=contexto).data
    datos["visible"] = puede_ver(actual, request.user, capacidades)
    return Response(datos)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def historial(request, pk):
    """El historial del período, del más reciente al más antiguo (§14.3)."""
    actual, _ = _periodo_visible(request, pk)
    return Response(EventoSerializer(actual.eventos.select_related("actor"), many=True).data)


# --- Obligaciones -----------------------------------------------------------------


def _solo_propias(empresa, capacidades) -> bool:
    """Si quien crea tiene que figurar como responsable o suplente.

    Aplica a quien no ve toda la empresa, salvo que la empresa lo permita
    (`Empresa.matriz_crear_para_otros`, en Configuración → Empresas).
    """
    return "matriz.ver_todas" not in capacidades and not empresa.matriz_crear_para_otros


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
        raise ValidationError({"area": "Solo puede crear obligaciones de sus temas."})
    if _solo_propias(empresa, capacidades) and request.user.pk not in (
        getattr(entrada.validated_data.get("responsable"), "pk", None),
        getattr(entrada.validated_data.get("suplente"), "pk", None),
    ):
        raise ValidationError(
            {
                "responsable": (
                    "Sin permiso para ver toda la empresa, usted tiene que ser el "
                    "responsable o el suplente de lo que crea: de lo contrario no "
                    "podría volver a verlo. Un administrador de la empresa puede "
                    "permitirlo en Configuración → Empresas."
                )
            }
        )
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


# --- Evidencias y cierre (fase 3) ---------------------------------------------------


def _responder_detalle(request, pk):
    actual, capacidades = _periodo_visible(request, pk)
    return Response(
        PeriodoDetalleSerializer(
            actual, context={"request": request, "capacidades": capacidades}
        ).data
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def documentos(request, pk):
    """Las evidencias del período (válidas y rechazadas); con `POST`, cargar
    una (`multipart/form-data` con `file`) (§14.4)."""
    actual, capacidades = _periodo_visible(request, pk)
    if request.method == "POST":
        exigir(request, "matriz.cargar", capacidades, actual)
        archivo = request.FILES.get("file")
        if archivo is None:
            raise ValidationError({"file": "Adjunte el archivo PDF."})
        documento = cierre.cargar_evidencia(
            periodo=actual,
            archivo=archivo,
            actor=request.user,
            contexto=get_request_context(request),
        )
        return Response(DocumentoSerializer(documento).data, status=status.HTTP_201_CREATED)
    lista = actual.documentos.exclude(estado=EstadoDocumento.ELIMINADO).select_related(
        "subido_por", "rechazado_por"
    )
    return Response(DocumentoSerializer(lista, many=True).data)


def _documento_visible(request, pk):
    """El documento si su período se puede ver; si no, 404 (§8.4)."""
    _, capacidades = empresa_de_la_matriz(request)
    documento = get_object_or_404(
        Documento.objects.select_related("periodo", "periodo__empresa"), pk=pk
    )
    visible = visibles(Periodo.objects.filter(pk=documento.periodo_id), request.user, capacidades)
    if not visible.exists() or documento.estado == EstadoDocumento.ELIMINADO:
        raise Http404()
    return documento, capacidades


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def documento_archivo(request, pk):
    """El PDF, en línea o como descarga con `?download=1`. Cada acceso queda en
    la auditoría (`document.accessed`): es un archivo que sale del sistema."""
    documento, _ = _documento_visible(request, pk)
    try:
        fichero = documento.archivo.open("rb")
    except FileNotFoundError as error:
        raise Http404("El archivo ya no está disponible en el servidor.") from error
    descarga = request.query_params.get("download") == "1"
    record_audit_event(
        actor=request.user,
        action="document.accessed",
        target=documento,
        module=MODULO,
        new_values={"descarga": descarga},
        context=get_request_context(request),
    )
    respuesta = FileResponse(fichero, content_type="application/pdf")
    disposicion = "attachment" if descarga else "inline"
    respuesta["Content-Disposition"] = (
        f"{disposicion}; filename*=UTF-8''{quote(documento.nombre_original)}"
    )
    respuesta["X-Content-Type-Options"] = "nosniff"
    return respuesta


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def documento_rechazar(request, pk):
    documento, capacidades = _documento_visible(request, pk)
    exigir(request, "matriz.validar", capacidades, documento.periodo)
    entrada = MotivoSerializer(data=request.data)
    entrada.is_valid(raise_exception=True)
    cierre.rechazar_documento(
        documento=documento,
        motivo=entrada.validated_data["reason"],
        actor=request.user,
        contexto=get_request_context(request),
    )
    return Response(DocumentoSerializer(Documento.objects.get(pk=pk)).data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def documento_eliminar(request, pk):
    documento, capacidades = _documento_visible(request, pk)
    exigir(request, "matriz.cargar", capacidades, documento.periodo)
    cierre.eliminar_documento(
        documento=documento, actor=request.user, contexto=get_request_context(request)
    )
    return Response(status=status.HTTP_204_NO_CONTENT)


def _accion_del_periodo(capacidad, funcion, con_motivo=False):
    @api_view(["POST"])
    @permission_classes([IsAuthenticated])
    def vista(request, pk):
        actual, capacidades = _periodo_visible(request, pk)
        exigir(request, capacidad, capacidades, actual)
        extra = {}
        if con_motivo:
            entrada = MotivoSerializer(data=request.data)
            entrada.is_valid(raise_exception=True)
            extra["motivo"] = entrada.validated_data["reason"]
        funcion(periodo=actual, actor=request.user, contexto=get_request_context(request), **extra)
        return _responder_detalle(request, pk)

    return vista


enviar = _accion_del_periodo("matriz.enviar", cierre.enviar)
validar = _accion_del_periodo("matriz.validar", cierre.validar)
devolver = _accion_del_periodo("matriz.validar", cierre.devolver, con_motivo=True)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cambiar_vencimiento(request, pk):
    """`{"due_date": "2026-10-20", "due_time": "17:00", "reason": "…"}` (§14.3)."""
    actual, capacidades = _periodo_visible(request, pk)
    exigir(request, "matriz.cambiar_fecha", capacidades, actual)
    entrada = CambioVencimientoSerializer(data=request.data)
    entrada.is_valid(raise_exception=True)
    cierre.cambiar_vencimiento(
        periodo=actual,
        fecha=entrada.validated_data["due_date"],
        hora=entrada.validated_data.get("due_time"),
        motivo=entrada.validated_data["reason"],
        actor=request.user,
        contexto=get_request_context(request),
    )
    return _responder_detalle(request, pk)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def documentos_resumen(request):
    """La vista Documentos (§15.7): expedientes con evidencia y pendientes."""
    _, capacidades = empresa_de_la_matriz(request)
    ahora = timezone.now()
    consulta = visibles(_consulta_base(), request.user, capacidades).annotate(
        validos=Count("documentos", filter=Q(documentos__estado=EstadoDocumento.VALIDO))
    )
    contexto = {"ahora": ahora}

    def filas(qs):
        resultado = []
        for periodo in qs.order_by("vence_en")[:200]:
            datos = PeriodoListaSerializer(periodo, context=contexto).data
            datos["documentos_validos"] = periodo.validos
            resultado.append(datos)
        return resultado

    return Response(
        {
            "with_evidence": filas(consulta.filter(validos__gt=0)),
            "pending": filas(consulta.filter(validos=0)),
        }
    )


# --- Recordatorios (fase 4) -------------------------------------------------------


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def configuracion_recordatorios(request):
    """La configuración de la empresa activa: la ve cualquiera con un rol de la
    Matriz y la cambia quien tiene `configurar` (§14.5)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    config = recordatorios.configuracion_de(empresa)
    if request.method == "PUT":
        exigir(request, "matriz.configurar", capacidades)
        anterior = ConfiguracionRecordatoriosSerializer(config).data
        entrada = ConfiguracionRecordatoriosSerializer(config, data=request.data)
        entrada.is_valid(raise_exception=True)
        config = entrada.save()
        nuevo = ConfiguracionRecordatoriosSerializer(config).data
        record_audit_event(
            actor=request.user,
            action="reminder_config.updated",
            target=empresa,
            module=MODULO,
            previous_values={k: v for k, v in anterior.items() if k != "updated_at"},
            new_values={k: v for k, v in nuevo.items() if k != "updated_at"},
            context=get_request_context(request),
        )
    datos = ConfiguracionRecordatoriosSerializer(config).data
    datos["can_edit"] = "matriz.configurar" in capacidades
    return Response(datos)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def notificaciones(request):
    """Las notificaciones de la empresa activa, paginadas (§14.5)."""
    _, capacidades = empresa_de_la_matriz(request)
    exigir(request, "matriz.ver_auditoria", capacidades)
    consulta = Notificacion.objects.select_related(
        "periodo__obligacion", "destinatario", "disparado_por"
    )
    estado = request.query_params.get("status")
    if estado in EstadoNotificacion.values:
        consulta = consulta.filter(estado=estado)
    paginador = DefaultPagination()
    pagina = paginador.paginate_queryset(consulta, request)
    return paginador.get_paginated_response(NotificacionSerializer(pagina, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def notificacion_reintentar(request, pk):
    """Reintentar un aviso fallido (§12.3). El período tiene que estar a la
    vista; si no, 404."""
    _, capacidades = empresa_de_la_matriz(request)
    notificacion = get_object_or_404(
        Notificacion.objects.select_related("periodo"),
        pk=pk,
        periodo__in=visibles(Periodo.objects.all(), request.user, capacidades),
    )
    exigir(request, "matriz.recordar", capacidades, notificacion.periodo)
    try:
        nueva = recordatorios.reintentar(notificacion, actor=request.user)
    except ValueError as error:
        raise ValidationError({"detail": str(error)}) from error
    record_audit_event(
        actor=request.user,
        action="notification.retried",
        target=notificacion.periodo,
        module=MODULO,
        new_values={"notificacion": notificacion.id, "resultado": nueva.estado},
        context=get_request_context(request),
    )
    nueva = Notificacion.objects.select_related("periodo__obligacion").get(pk=nueva.pk)
    return Response(NotificacionSerializer(nueva).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def recordatorios_del_periodo(request, pk):
    """La programación de los avisos y las notificaciones del período (§12.5)."""
    actual, capacidades = _periodo_visible(request, pk)
    lista = actual.notificaciones.select_related(
        "periodo__obligacion", "destinatario", "disparado_por"
    )
    return Response(
        {
            "suspended": actual.cerrado or actual.recordatorios_suspendidos,
            "can_send": puede("matriz.recordar", actual, request.user, capacidades)
            and not actual.cerrado,
            "schedule": recordatorios.programacion(actual),
            "notifications": NotificacionSerializer(lista, many=True).data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def recordatorio_enviar(request, pk):
    """«Reenviar recordatorio» (§14.5)."""
    actual, capacidades = _periodo_visible(request, pk)
    exigir(request, "matriz.recordar", capacidades, actual)
    if actual.cerrado:
        raise ValidationError(
            {"detail": "El período está cerrado: sus recordatorios están suspendidos."}
        )
    try:
        enviadas = recordatorios.enviar_manual(
            periodo=actual, actor=request.user, contexto=get_request_context(request)
        )
    except ValueError as error:
        raise ValidationError({"detail": str(error)}) from error
    lista = Notificacion.objects.select_related("periodo__obligacion").filter(
        pk__in=[n.pk for n in enviadas if n]
    )
    return Response(NotificacionSerializer(lista, many=True).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def recordatorio_vista_previa(request, pk):
    """El correo tal como saldría, sin enviarlo (`?kind=`, §12.5)."""
    actual, _ = _periodo_visible(request, pk)
    tipo = request.query_params.get("kind", TipoNotificacion.RECORDATORIO)
    if tipo not in TipoNotificacion.values:
        raise ValidationError({"kind": "Tipo de aviso desconocido."})
    return Response(recordatorios.vista_previa(actual, tipo))


# --- Calendario, reportes, exportaciones y auditoría (fase 5) -----------------------

FORMATOS = {"xlsx", "pdf"}

#: Los filtros de la matriz, con su nombre legible para la cabecera del archivo.
NOMBRES_DE_FILTRO = {
    "q": "búsqueda",
    "status": "estado",
    "area": "tema",
    "entity": "entidad",
    "responsible": "responsable",
    "priority": "prioridad",
    "stage": "etapa",
    "due_today": "vence hoy",
    "due_from": "desde",
    "due_to": "hasta",
}


def _describir_filtros(params) -> str:
    partes = [
        f"{nombre}: {params.get(clave)}"
        for clave, nombre in NOMBRES_DE_FILTRO.items()
        if params.get(clave)
    ]
    return ", ".join(partes)


def _exportacion_auditada(request, empresa, capacidades, tipo):
    """El formato pedido, si se puede exportar; deja la traza (§16)."""
    formato = request.query_params.get("export")
    if formato not in FORMATOS:
        raise ValidationError({"export": "Formato desconocido: use xlsx o pdf."})
    exigir(request, "matriz.exportar", capacidades)
    record_audit_event(
        actor=request.user,
        action="report.exported",
        target=empresa,
        module=MODULO,
        new_values={
            "reporte": tipo,
            "formato": formato,
            "filtros": {k: v for k, v in request.query_params.items() if k != "export"},
        },
        context=get_request_context(request),
    )
    return formato


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def calendario(request):
    """Los períodos que vencen en un mes, en la hora de la empresa (§15.6)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    hoy = timezone.now().astimezone(estados.zona_de(empresa)).date()
    try:
        anio = int(request.query_params.get("year", hoy.year))
        mes = int(request.query_params.get("month", hoy.month))
        inicio = datetime.date(anio, mes, 1)
    except ValueError:
        raise ValidationError({"detail": "Indique un año y un mes válidos."}) from None
    siguiente = datetime.date(anio + mes // 12, mes % 12 + 1, 1)
    zona = estados.zona_de(empresa)
    consulta = visibles(_consulta_base(), request.user, capacidades).filter(
        vence_en__gte=datetime.datetime.combine(inicio, datetime.time(), zona),
        vence_en__lt=datetime.datetime.combine(siguiente, datetime.time(), zona),
    )
    ahora = timezone.now()
    return Response(
        {
            "year": anio,
            "month": mes,
            "periods": PeriodoListaSerializer(
                consulta.order_by("vence_en", "id"), many=True, context={"ahora": ahora}
            ).data,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reportes(request):
    """Indicadores y conteos por área y entidad (§15.8, §16); con `export`,
    el archivo."""
    empresa, capacidades = empresa_de_la_matriz(request)
    consulta = visibles(_consulta_base(), request.user, capacidades)
    rango = {
        clave: request.query_params[clave]
        for clave in ("due_from", "due_to")
        if request.query_params.get(clave)
    }
    consulta = _filtrar(consulta, rango, empresa, timezone.now())
    datos = informes.calcular(consulta)
    if "export" in request.query_params:
        formato = _exportacion_auditada(request, empresa, capacidades, "reporte")
        return informes.exportar_reporte(
            datos,
            empresa=empresa,
            usuario=request.user,
            formato=formato,
            filtros=_describir_filtros(rango),
        )
    return Response(datos)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auditoria(request):
    """El historial de los períodos de la empresa, del más reciente al más
    antiguo, con filtros (§14.2)."""
    empresa, capacidades = empresa_de_la_matriz(request)
    exigir(request, "matriz.ver_auditoria", capacidades)
    consulta = EventoPeriodo.objects.select_related("actor", "periodo__obligacion")
    params = request.query_params
    actor = params.get("actor")
    if actor == "sistema":
        consulta = consulta.filter(actor__isnull=True)
    elif actor:
        if not actor.isdigit():
            raise ValidationError({"actor": "Debe ser un identificador numérico o «sistema»."})
        consulta = consulta.filter(actor_id=actor)
    if params.get("action"):
        consulta = consulta.filter(accion=params["action"])
    zona = estados.zona_de(empresa)
    for parametro, operador, sumar in (("from", "gte", 0), ("to", "lt", 1)):
        valor = params.get(parametro)
        if valor:
            try:
                dia = datetime.date.fromisoformat(valor) + datetime.timedelta(days=sumar)
            except ValueError:
                raise ValidationError({parametro: "Use una fecha AAAA-MM-DD."}) from None
            consulta = consulta.filter(
                **{f"created_at__{operador}": datetime.datetime.combine(dia, datetime.time(), zona)}
            )
    paginador = DefaultPagination()
    pagina = paginador.paginate_queryset(consulta, request)
    return paginador.get_paginated_response(EventoAuditoriaSerializer(pagina, many=True).data)


__all__ = ["puede"]
