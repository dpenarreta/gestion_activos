"""Endpoints de los informes ejecutivos, montados en `/api/v1/informes/` (parte
del módulo Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

En Nexo la generación vivía en Next.js (`POST /api/reports/executive`) y
Django solo guardaba el resultado que le mandaban (`POST /reports/executive/`,
`/audit/`, `/integrity-incidents/`) y exponía los calculadores intermedios
(`*-team-kpis/`, `team-subutilization/`, `monthly-report/`). Aquí la
generación es del servidor, así que esos endpoints no se portan: el cliente ya
no manda ni el documento ni la bitácora, y los calculadores aceptaban
cualquier lista de `user_ids` sin mirar la jerarquía de quien preguntaba.

Errores en el contrato uniforme `{"error": {"code", "message", "details"}}`.
Un informe que no existe o que no se puede ver es 404 en los dos casos (en
Nexo, 403 si existía con otro `scope`): no se revela que existe.
"""

from django.http import HttpResponse
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.analytics.workload import get_month_closure_period
from apps.core.responses import error_response
from apps.descargas.middleware import marcar
from apps.permissions.permissions import Requiere

from . import access, exportacion, services
from .documento import construir_paginas
from .models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
)
from .serializers import (
    ClosureStatusQuerySerializer,
    EventoSerializer,
    GenerarInformeSerializer,
    ListadoQuerySerializer,
    RosterQuerySerializer,
)
from .services import InformeError

PuedeVer = Requiere(access.VER, access.GENERAR, access.ADMINISTRAR)
PuedeGenerar = Requiere(access.GENERAR, access.ADMINISTRAR)
PuedeAdministrar = Requiere(access.ADMINISTRAR)


def _primer_mensaje(detalle) -> str | None:
    if isinstance(detalle, str):
        return detalle
    if isinstance(detalle, dict):
        for valor in detalle.values():
            if mensaje := _primer_mensaje(valor):
                return mensaje
    if isinstance(detalle, list | tuple):
        for valor in detalle:
            if mensaje := _primer_mensaje(valor):
                return mensaje
    return None


class InformesView(APIView):
    """Base: sesión y el permiso de cada vista; errores al contrato."""

    permission_classes = [IsAuthenticated, PuedeVer]

    def handle_exception(self, exc):
        if isinstance(exc, InformeError):
            return error_response(exc.code, exc.message, exc.status)
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class, data):
        serializer = serializer_class(data=data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class MeView(InformesView):
    """`GET me/`: qué puede hacer la persona en Informes."""

    def get(self, request):
        return Response(
            {
                "permissions": access.effective_codenames(request.user),
                "alcance_completo": access.alcance_completo(request.user),
                "scope": access.scope_de(request.user),
            }
        )


class RosterView(InformesView):
    """`GET roster/?roles=&areas=&colaboradores=`: a quiénes incluiría un
    informe con esos filtros (para el asistente de generación)."""

    permission_classes = [IsAuthenticated, PuedeGenerar]

    def get(self, request):
        query = self.validated(RosterQuerySerializer, request.query_params)
        return Response(
            access.resolver_roster(
                request.user,
                roles=query.get("roles") or (),
                areas=query.get("areas") or (),
                colaboradores=query.get("colaboradores") or (),
            )
        )


class ClosureStatusView(InformesView):
    """`GET executive/closure-status/?year=&month=`: si el mes tiene cierre y
    con qué corte, para que el asistente lo avise ANTES de generar. Separado
    del cierre de Tareas (que pide `tareas.cerrar_mes`): aquí solo se lee el
    corte."""

    permission_classes = [IsAuthenticated, PuedeGenerar]

    def get(self, request):
        query = self.validated(ClosureStatusQuerySerializer, request.query_params)
        closure, _natural, _efectivo = get_month_closure_period(query["year"], query["month"])
        if closure is None:
            return Response(
                {
                    "closed": False,
                    "cutoff_date": None,
                    "closure_type": None,
                    "closed_at": None,
                    "calendar_days_total": None,
                    "calendar_days_considered": None,
                    "working_days_considered": None,
                    "working_hours_considered": None,
                }
            )
        return Response(
            {
                "closed": True,
                "cutoff_date": closure.cutoff_date.date().isoformat(),
                "closure_type": closure.closure_type,
                "closed_at": closure.closed_at,
                "calendar_days_total": closure.calendar_days_total,
                "calendar_days_considered": closure.calendar_days_considered,
                "working_days_considered": closure.working_days_considered,
                "working_hours_considered": closure.working_hours_considered,
            }
        )


class GenerarView(InformesView):
    """`POST executive/`: genera, guarda inmutable y devuelve el informe
    completo (201). Si la misma persona pide lo mismo dentro de los 30
    segundos siguientes, devuelve ese mismo informe (200) en vez de emitir
    otro."""

    permission_classes = [IsAuthenticated, PuedeGenerar]

    def post(self, request):
        datos = self.validated(GenerarInformeSerializer, request.data)
        snapshot, creado = services.generar_informe(request.user, datos["pedido"])
        return Response(
            services.detalle(snapshot),
            status=status.HTTP_201_CREATED if creado else status.HTTP_200_OK,
        )


class ListadoView(InformesView):
    """`GET executive/list/?page=&page_size=&tipo=&estado=`: el historial de
    informes que la persona puede abrir, sin el documento."""

    def get(self, request):
        query = self.validated(ListadoQuerySerializer, request.query_params)
        ids = services.informes_visibles(
            request.user, tipo=query.get("tipo") or None, estado=query.get("estado") or None
        )
        page, page_size = query["page"], query["page_size"]
        filas = services.pagina_de_informes(ids, page, page_size)
        return Response(
            {
                "page": page,
                "page_size": page_size,
                "total": len(ids),
                "reports": [services.fila_del_listado(s) for s in filas],
            }
        )


class DetalleView(InformesView):
    """`GET executive/<report_id>/`: el informe congelado, nunca recalculado,
    con sus once páginas. Queda en la bitácora como «abierto»."""

    def get(self, request, report_id: str):
        snapshot = services.informe_visible(request.user, report_id)
        services.log_report_audit(
            report_id=snapshot.report_id,
            action=ExecutiveReportAuditLog.Action.VIEWED,
            user=request.user,
        )
        return Response(services.detalle(snapshot))


class ExportarView(InformesView):
    """`GET executive/<report_id>/export/`: el informe en Excel, sobre las
    mismas páginas que la vista imprimible."""

    def get(self, request, report_id: str):
        snapshot = services.informe_visible(request.user, report_id)
        contenido = exportacion.libro_del_informe(
            construir_paginas(services.ensure_snapshot_meta(snapshot))
        )
        services.log_report_audit(
            report_id=snapshot.report_id,
            action=ExecutiveReportAuditLog.Action.EXPORTED_EXCEL,
            user=request.user,
        )
        marcar(
            request, modulo="informes_gh", reporte="informe_ejecutivo", report_id=snapshot.report_id
        )
        respuesta = HttpResponse(contenido, content_type=exportacion.CONTENT_TYPE)
        respuesta["Content-Disposition"] = f'attachment; filename="{snapshot.report_id}.xlsx"'
        respuesta["Cache-Control"] = "no-store"
        return respuesta


class EventoView(InformesView):
    """`POST executive/<report_id>/eventos/` `{"action": "exported_pdf"}`: el
    navegador avisa que imprimió el PDF (lo hace el frontend, no el
    servidor)."""

    def post(self, request, report_id: str):
        datos = self.validated(EventoSerializer, request.data)
        snapshot = services.informe_visible(request.user, report_id)
        services.log_report_audit(
            report_id=snapshot.report_id, action=datos["action"], user=request.user
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


def _fila_de_bitacora(e: ExecutiveReportAuditLog) -> dict:
    return {
        "id": e.pk,
        "report_id": e.report_id,
        "action": e.action,
        "action_label": e.get_action_display(),
        "user": {"id": e.user_id, "name": e.user.get_full_name() or e.user.username},
        "step": e.step,
        "message": e.message,
        "period": e.period,
        "fecha_corte": e.fecha_corte,
        "filters_applied": e.filters_applied,
        "collaborator_count": e.collaborator_count,
        "generation_ms": e.generation_ms,
        "created_at": e.created_at,
    }


class BitacoraView(InformesView):
    """`GET executive/<report_id>/audit/`: la bitácora del informe
    (`informes_gh.administrar`). También responde por un Report ID sin
    informe (una generación fallida deja solo su bitácora)."""

    permission_classes = [IsAuthenticated, PuedeAdministrar]

    def get(self, request, report_id: str):
        eventos = ExecutiveReportAuditLog.objects.filter(report_id=report_id).select_related("user")
        filas = [_fila_de_bitacora(e) for e in eventos.order_by("created_at", "pk")]
        if not filas:
            raise InformeError("Informe no encontrado.", code="not_found", status=404)
        return Response({"report_id": report_id, "events": filas})


class IncidentesView(InformesView):
    """`GET executive/integrity-incidents/?report_id=&page=&page_size=`: los
    incidentes de integridad (`informes_gh.administrar`). En Nexo no había
    lectura; sin ella el registro no le servía a nadie."""

    permission_classes = [IsAuthenticated, PuedeAdministrar]

    def get(self, request):
        query = self.validated(ListadoQuerySerializer, request.query_params)
        qs = ExecutiveReportIntegrityIncident.objects.order_by("-detected_at", "-pk")
        report_id = (request.query_params.get("report_id") or "").strip()[:40]
        if report_id:
            qs = qs.filter(report_id=report_id)
        page, page_size = query["page"], query["page_size"]
        total = qs.count()
        filas = qs[(page - 1) * page_size : page * page_size]
        return Response(
            {
                "page": page,
                "page_size": page_size,
                "total": total,
                "incidents": [
                    {
                        "id": i.pk,
                        "report_id": i.report_id,
                        "field_path": i.field_path,
                        "expected_value": i.expected_value,
                        "actual_value": i.actual_value,
                        "source": i.source,
                        "user_id": i.user_id,
                        "detected_at": i.detected_at,
                    }
                    for i in filas
                ],
            }
        )
