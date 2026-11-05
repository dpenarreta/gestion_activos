"""Endpoints del motor de KPI, montados en `/api/v1/analytics/` (parte del
módulo Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

Réplica de las vistas de `apps.analytics` de Nexo (que allá vivían en
`/kpis/`, `/analytics/` y `/predictive/`; aquí, bajo `kpis/`, la raíz y
`predictive/`). Las vistas resuelven parámetros, autorización y empresa, y
delegan en los módulos del motor; no calculan nada propio.

Cambios frente a Nexo (las fórmulas no cambian):

- Entrar exige `kpi.acceder`; cada vista suma el permiso de su acción
  (`access.py`). Los chequeos por rol de Nexo (`is_leadership`,
  `can_view_team`, `CAN_VIEW_OPERATIONAL_RISK`, ADMINISTRADOR) son ahora
  permisos del catálogo.
- La persona consultada tiene que trabajar en la empresa activa (si no, 404:
  no se revela que existe en otra) y estar en el ámbito de quien consulta
  según el organigrama (si no, 403, como en Nexo).
- Errores en el contrato uniforme `{"error": {"code", "message",
  "details"}}`.
- Cada cálculo recibe el instante de la petición (`timezone.now()`), no el
  reloj del módulo, para que todo el bundle mida el mismo instante.
"""

import time

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.descargas.middleware import marcar
from apps.permissions.permissions import Requiere
from apps.tasks import jerarquia
from apps.tasks.models import Task
from apps.tasks.roles import gh_role_of, gh_roles_of, in_active_company
from apps.tasks.rounding import round_half_up

from . import access, ajustes, exportacion
from .audit_history import get_score_series
from .benchmark import compute_personal_evolution, compute_smart_benchmark
from .capacity_forecast import compute_capacity_forecast, compute_team_capacity_forecast
from .configuracion import get_effective_config_string, set_config_value
from .errores import AnalyticsError, forbidden, not_found
from .explain import (
    derived_normalized_value,
    reliability_pct_from_observations,
    reliability_pct_from_stars,
)
from .health_score import (
    ESCALA_INTERPRETACION_EQUILIBRIO,
    classify_estado_operativo,
    compute_health_score,
)
from .history import compute_consistency, compute_monthly_history
from .insights_engine import (
    INSIGHTS_ENGINE_VERSION,
    compute_confidence,
    compute_equilibrio_insights,
    compute_indicator_relations,
    compute_insights,
    compute_personal_benchmark,
    compute_recommendation_reevaluation,
    explain_equilibrio_factor,
    explain_equilibrio_impact,
    explain_equilibrio_meaning,
    get_score_trend_explanation,
    prioritize_insights,
    prioritize_recommendations,
)
from .kpi_simulate import is_valid_scenario, simulate_kpi_scenario
from .models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from .operational_risk import compute_operational_risk
from .prediction_engine import compute_project_delay_prediction, compute_subutilizacion_predictions
from .preventive_intelligence import compute_preventive_alerts, compute_team_preventive_alerts
from .recommendations import compute_team_recommendations
from .scoring import (
    compute_data_quality,
    compute_target_time_precision,
)
from .serializers import (
    AddParticipantsSimulationSerializer,
    AdjustTargetTimeSimulationSerializer,
    CurveUpdateSerializer,
    KpiStartDateUpdateSerializer,
    MonthQuerySerializer,
    PredictionWindowUpdateSerializer,
    RangeQuerySerializer,
    RedistributeLoadSimulationSerializer,
    RoleCompatibilityUpdateSerializer,
    RoleTargetUpdateSerializer,
    parse_month,
)
from .services import (
    build_analytics_bundle_payload,
    build_executive_dashboard_payload,
    build_kpi_payload,
    build_kpi_range_payload,
    build_prediction_bundle_payload,
    build_team_kpi_rows,
    get_team_members,
    get_visible_team_project_ids,
    notify_if_high_risk,
)
from .simulate_engine import (
    simulate_add_participants,
    simulate_adjust_target_time,
    simulate_redistribute_load,
)
from .trend_engine import compute_trend_engine

User = get_user_model()

#: Tope defensivo de meses generados antes de rechazar un rango > 24 (Nexo).
_MAX_MONTHS_TO_GENERATE = 1000

CanAccess = Requiere(access.ACCEDER)
CanViewTeam = Requiere(access.EQUIPO)
CanViewExecutive = Requiere(access.EJECUTIVO)
CanAdminister = Requiere(access.ADMINISTRAR)
CanViewRisk = Requiere(access.RIESGO_VER)


def _primer_mensaje(detalle) -> str | None:
    if isinstance(detalle, str):
        return detalle
    if isinstance(detalle, dict):
        for valor in detalle.values():
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    if isinstance(detalle, (list, tuple)):
        for valor in detalle:
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    return None


def _display(user) -> str:
    """El nombre que muestra el motor (en Nexo, `first_name or username`)."""
    return user.first_name or user.username


def _parse_months_range(from_str: str, to_str: str) -> list[tuple[int, int]]:
    fy, fm = parse_month(from_str)
    ty, tm = parse_month(to_str)
    months: list[tuple[int, int]] = []
    cy, cm = fy, fm
    while (cy, cm) <= (ty, tm) and len(months) < _MAX_MONTHS_TO_GENERATE:
        months.append((cy, cm))
        cm += 1
        if cm > 12:
            cm = 1
            cy += 1
    return months


def _parse_as_of(request):
    """`?as_of=<ISO>` opcional; `timezone.now()` si falta o no es válido."""
    raw = request.query_params.get("as_of")
    if not raw:
        return timezone.now()
    try:
        parsed = parse_datetime(raw)
    except ValueError:
        parsed = None
    if parsed is None:
        return timezone.now()
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)


class AnalyticsView(APIView):
    """Base: sesión y `kpi.acceder`; errores del motor al contrato."""

    permission_classes = [IsAuthenticated, CanAccess]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, AnalyticsError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def target_or_error(self, user_id: int):
        """La persona consultada: de la empresa activa (si no, 404) y en el
        ámbito de quien consulta (si no, 403)."""
        target = ajustes.member_or_404(user_id)
        if not access.can_view_target(self.request.user, target):
            raise forbidden("No tiene permiso para ver los KPI de esta persona.")
        return target


# ── Acceso ──────────────────────────────────────────────────────────────────


class MeView(AnalyticsView):
    """`GET me/`: qué puede ver la persona en el módulo."""

    def get(self, request):
        user = request.user
        return Response(
            {
                "user_id": user.id,
                "permissions": access.effective_codenames(user),
                "role": gh_role_of(user),
                "roles": gh_roles_of(user),
                "has_cargo": jerarquia.cargo_de(user) is not None,
                "team_size": len(jerarquia.equipo_ids(user)),
                "is_admin": access.is_admin(user),
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "formula_set_version": FORMULA_SET_VERSION,
            }
        )


# ── KPI (Nexo: /kpis/) ──────────────────────────────────────────────────────


class KpiMeView(AnalyticsView):
    """`GET kpis/me/?month=YYYY-MM`: sus propios KPI."""

    def get(self, request):
        query = self.validated(MonthQuerySerializer, data=request.query_params)
        payload = build_kpi_payload(
            actor=request.user, target=request.user, month_param=query.get("month")
        )
        return Response(payload)


class KpiMeRangeView(AnalyticsView):
    """`GET kpis/me/range/?from=YYYY-MM&to=YYYY-MM`: sus KPI por rango de
    meses (de 2 a 24, como en Nexo)."""

    def get(self, request):
        query = self.validated(RangeQuerySerializer, data=request.query_params)
        from_str, to_str = query["from"], query["to"]
        if from_str >= to_str:
            raise AnalyticsError(
                "El mes de inicio debe ser anterior al de fin.",
                details={"from": ["Debe ser anterior a «to»."]},
            )
        months = _parse_months_range(from_str, to_str)
        if len(months) < 2:
            raise AnalyticsError("El rango debe incluir al menos 2 meses.")
        if len(months) > 24:
            raise AnalyticsError("El rango no puede superar 24 meses.")
        return Response(
            build_kpi_range_payload(
                user=request.user, from_str=from_str, to_str=to_str, months=months
            )
        )


class KpiUserView(AnalyticsView):
    """`GET kpis/<user_id>/?month=YYYY-MM`: los KPI de alguien de su ámbito.
    El motivo de las ausencias se enmascara según quién consulta (LOPDP)."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        query = self.validated(MonthQuerySerializer, data=request.query_params)
        return Response(
            build_kpi_payload(actor=request.user, target=target, month_param=query.get("month"))
        )


class ExecutiveDashboardView(AnalyticsView):
    """`GET kpis/executive/`: resumen ejecutivo de su equipo ejecutor
    (`kpi.ejecutivo`; en Nexo, `is_leadership`)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewExecutive]

    def get(self, request):
        return Response(build_executive_dashboard_payload(actor=request.user, now=timezone.now()))


class TeamCapacityView(AnalyticsView):
    """`GET kpis/team-capacity/`: capacidad proyectada de su equipo ejecutor
    (`kpi.equipo`)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewTeam]

    def get(self, request):
        members = access.executor_members(request.user)
        if not members:
            return Response(
                {
                    "members": [],
                    "summary": {
                        "total": 0,
                        "alta": 0,
                        "limitada": 0,
                        "sobrecargados": 0,
                        "sin_planificacion": 0,
                    },
                }
            )
        now = timezone.now()
        forecasts = compute_team_capacity_forecast(user_ids=[m.id for m in members], now=now)
        payload_members = [
            {"id": m.id, "name": _display(m), "role": gh_role_of(m), **forecasts[m.id]}
            for m in members
        ]
        summary = {
            "total": len(payload_members),
            "alta": sum(1 for x in payload_members if x["estado"] == "alta"),
            "limitada": sum(1 for x in payload_members if x["estado"] == "limitada"),
            "sobrecargados": sum(1 for x in payload_members if x["estado_color"] == "red"),
            "sin_planificacion": sum(
                1 for x in payload_members if x["estado"] == "sin-planificacion"
            ),
        }
        return Response({"members": payload_members, "summary": summary})


class TeamKpiView(AnalyticsView):
    """`GET kpis/team/?month=YYYY-MM`: snapshot mensual de su equipo
    ejecutor (`kpi.equipo`). Réplica campo por campo de Nexo."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewTeam]

    def get(self, request):
        query = self.validated(MonthQuerySerializer, data=request.query_params)
        now = timezone.now()
        if query.get("month"):
            year, month = parse_month(query["month"])
        else:
            year, month = now.year, now.month
        return Response(
            {"users": build_team_kpi_rows(actor=request.user, year=year, month=month, now=now)}
        )


# ── Exportación a Excel (05/11/2026) ────────────────────────────────────────


def _periodo(query, now) -> tuple[int, int]:
    if query.get("month"):
        return parse_month(query["month"])
    return now.year, now.month


def _excel(request, contenido: bytes, nombre: str, **referencia) -> HttpResponse:
    """El .xlsx como descarga, anotado para el registro de descargas
    (`apps.descargas`: el middleware guarda su huella con esta referencia)."""
    marcar(request, modulo="kpi", **referencia)
    respuesta = HttpResponse(contenido, content_type=exportacion.CONTENT_TYPE)
    respuesta["Content-Disposition"] = f'attachment; filename="{nombre}"'
    respuesta["Cache-Control"] = "no-store"
    return respuesta


class KpiMeExportView(AnalyticsView):
    """`GET kpis/me/export/?month=YYYY-MM`: «Mis KPI» del mes en Excel
    (`kpi.acceder`, como `kpis/me/`). Hojas: Resumen, Tareas y Horas por
    semana. Es el titular: ve el desglose de sus propias ausencias."""

    def get(self, request):
        query = self.validated(MonthQuerySerializer, data=request.query_params)
        now = timezone.now()
        year, month = _periodo(query, now)
        clave = exportacion.clave_del_periodo(year, month)
        payload = build_kpi_payload(actor=request.user, target=request.user, month_param=clave)
        contenido = exportacion.mis_kpi(
            actor=request.user,
            target=request.user,
            payload=payload,
            year=year,
            month=month,
            now=now,
        )
        return _excel(request, contenido, f"mis-kpi-{clave}.xlsx", reporte="mis_kpi", periodo=clave)


class TeamKpiExportView(AnalyticsView):
    """`GET kpis/team/export/?month=YYYY-MM`: el KPI del equipo en Excel, una
    fila por persona (`kpi.equipo`, el mismo equipo ejecutor que
    `kpis/team/`). Las horas de ausencia van sin tipo salvo para quien tiene
    `ausencias.medicas_ver`."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewTeam]

    def get(self, request):
        query = self.validated(MonthQuerySerializer, data=request.query_params)
        now = timezone.now()
        year, month = _periodo(query, now)
        clave = exportacion.clave_del_periodo(year, month)
        filas = build_team_kpi_rows(actor=request.user, year=year, month=month, now=now)
        contenido = exportacion.kpi_del_equipo(
            actor=request.user, filas=filas, year=year, month=month, now=now
        )
        return _excel(
            request, contenido, f"kpi-equipo-{clave}.xlsx", reporte="kpi_equipo", periodo=clave
        )


class ExecutiveDashboardExportView(AnalyticsView):
    """`GET kpis/executive/export/`: el resumen ejecutivo del mes en curso
    (con su tendencia de seis meses) en Excel (`kpi.ejecutivo`, el mismo
    equipo que `kpis/executive/`)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewExecutive]

    def get(self, request):
        now = timezone.now()
        payload = build_executive_dashboard_payload(actor=request.user, now=now)
        clave = exportacion.clave_del_periodo(now.year, now.month)
        contenido = exportacion.resumen_ejecutivo(payload=payload, year=now.year, month=now.month)
        return _excel(
            request,
            contenido,
            f"kpi-resumen-ejecutivo-{clave}.xlsx",
            reporte="kpi_resumen_ejecutivo",
            periodo=clave,
        )


# ── Analytics (Nexo: /analytics/) ───────────────────────────────────────────


class AnalyticsBundleView(AnalyticsView):
    """`GET <user_id>/`: bundle completo (Equilibrio Operativo, Performance
    Score, alertas, tendencias, consistencia, anomalías, predicción y
    calidad del dato) de una persona."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        return Response(
            build_analytics_bundle_payload(actor=request.user, target=target, now=timezone.now())
        )


class InsightsView(AnalyticsView):
    """`GET insights/<user_id>/`: Motor de Insights (reglas, sin IA)."""

    def get(self, request, user_id: int):
        from .pipeline import run_analytics_pipeline

        target = self.target_or_error(user_id)
        now = timezone.now()
        pipeline = run_analytics_pipeline(user=target, now=now)
        operational_risk = compute_operational_risk(user=target, now=now)
        monthly = compute_monthly_history(user=target, months_back=6, now=now)
        capacity = compute_capacity_forecast(user=target, now=now)

        insights = compute_insights(
            user=target, now=now, pipeline=pipeline, operational_risk=operational_risk
        )
        personal_benchmark = compute_personal_benchmark(
            user=target,
            current_score=pipeline["performance_score"]["score"],
            data_quality_pct=pipeline["data_quality"]["pct"],
            now=now,
        )
        reevaluations = compute_recommendation_reevaluation(
            user=target,
            current_alerts=pipeline["alerts"],
            current_risk_score=operational_risk["score"],
            now=now,
        )
        performance_trend_explained = get_score_trend_explanation(
            user=target,
            kind="performance_score",
            current_score=pipeline["performance_score"]["score"],
            current_factors=pipeline["performance_score"]["factors"],
            now=now,
            days_ago=30,
        )
        relations = compute_indicator_relations(
            monthly, pipeline["consistency"], operational_risk, capacity
        )
        return Response(
            {
                "insights": insights,
                "prioritized": prioritize_insights(insights),
                "relations": relations,
                "personal_benchmark": personal_benchmark,
                "reevaluations": reevaluations,
                "performance_trend_explained": performance_trend_explained,
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "insights_engine_version": INSIGHTS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


class EquilibrioView(AnalyticsView):
    """`GET equilibrio/<user_id>/`: interpretación del Equilibrio Operativo
    (estado, tendencia, dimensiones, calidad)."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        now = timezone.now()
        started_at = time.monotonic()
        value = compute_health_score(user=target, now=now)
        tiempo_calculo_ms = round_half_up((time.monotonic() - started_at) * 1000)
        consistency = compute_consistency(user=target, now=now)
        data_quality = compute_data_quality(user_ids=[target.id])

        estado = classify_estado_operativo(value["score"])
        trend = get_score_trend_explanation(
            user=target,
            kind="health_score",
            current_score=value["score"],
            current_factors=value["factors"],
            now=now,
            days_ago=30,
        )
        insight_confidence = compute_confidence(
            observations=consistency["weeks_analyzed"] if consistency.get("available") else 2,
            data_quality_pct=data_quality["pct"],
            consistent=(
                (consistency["level"] in ("muy-consistente", "consistente"))
                if consistency.get("available")
                else None
            ),
        )
        insights = compute_equilibrio_insights(value, insight_confidence)
        dimensiones = []
        for factor in value["factors"]:
            normalized_value = derived_normalized_value(factor["points"], factor["weight"])
            dimensiones.append(
                {
                    **factor,
                    "normalized_value": normalized_value,
                    "explicacion": explain_equilibrio_factor(factor["name"], normalized_value),
                }
            )
        strengths = [i for i in insights if i["tone"] == "positive"]
        weaknesses = [i for i in insights if i["tone"] == "risk"]
        advertencias: list[str] = []
        if not consistency.get("available"):
            advertencias.append(
                "Consistencia sin historial suficiente — se usó un valor neutro (70/100) en esa dimensión."
            )
        return Response(
            {
                "health_score": value,
                "dimensiones": dimensiones,
                "estado": estado,
                "escala": ESCALA_INTERPRETACION_EQUILIBRIO,
                "trend": trend,
                "meaning": explain_equilibrio_meaning(estado, trend),
                "impact": explain_equilibrio_impact(estado),
                "strengths": strengths,
                "weaknesses": weaknesses,
                "recommendations": [i["accion"] for i in weaknesses if i.get("accion") is not None],
                "confidence": {
                    "data_quality_pct": data_quality["pct"],
                    "reliability_pct": (
                        reliability_pct_from_stars(consistency["reliability"]["stars"])
                        if consistency.get("available")
                        else 50
                    ),
                },
                "calidad": {
                    "engine_version": ANALYTICS_ENGINE_VERSION,
                    "formula_set_version": FORMULA_SET_VERSION,
                    "insights_engine_version": INSIGHTS_ENGINE_VERSION,
                    "fecha": now.isoformat(),
                    "origen": "Tareas del mes en curso, carga horaria, consistencia semanal y capacidad proyectada",
                    "cache_active": False,
                    "tiempo_calculo_ms": tiempo_calculo_ms,
                    "registros_utilizados": {
                        "semanas_consistencia": (
                            consistency["weeks_analyzed"] if consistency.get("available") else 0
                        ),
                        "dias_consistencia": (
                            consistency["days_analyzed"] if consistency.get("available") else 0
                        ),
                    },
                    "registros_descartados": (
                        consistency["explain"]["periods_excluded"]
                        if consistency.get("available")
                        else []
                    ),
                    "advertencias": advertencias,
                },
            }
        )


class OperationalRiskView(AnalyticsView):
    """`GET operational-risk/<user_id>/`: Índice de Riesgo Operativo
    (`inteligencia_preventiva.ver`, además del ámbito)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewRisk]

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        now = timezone.now()
        value = compute_operational_risk(user=target, now=now)
        consistency = compute_consistency(user=target, now=now)
        data_quality = compute_data_quality(user_ids=[target.id])
        confidence = {
            "data_quality_pct": data_quality["pct"],
            "reliability_pct": (
                reliability_pct_from_stars(consistency["reliability"]["stars"])
                if consistency.get("available")
                else 50
            ),
        }
        trend_explained = get_score_trend_explanation(
            user=target,
            kind="operational_risk",
            current_score=value["score"],
            current_factors=value["factors"],
            now=now,
            days_ago=30,
        )
        return Response(
            {
                **value,
                "confidence": confidence,
                "trend_explained": trend_explained,
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


class TeamOperationalRiskView(AnalyticsView):
    """`GET operational-risk/team/`: Riesgo Operativo de su equipo ejecutor.
    Efecto lateral (como en Nexo): avisa al jefe inmediato de quien esté en
    riesgo Alto o Crítico, una vez por persona y mes."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewRisk]

    def get(self, request):
        now = timezone.now()
        subordinates = access.executor_members(request.user)
        if not subordinates:
            return Response(
                {
                    "members": [],
                    "summary": {"bajo": 0, "medio": 0, "alto": 0, "critico": 0},
                    "engine_version": ANALYTICS_ENGINE_VERSION,
                    "last_updated": now.isoformat(),
                }
            )
        members = []
        for s in subordinates:
            value = compute_operational_risk(user=s, now=now)
            notify_if_high_risk(user=s, risk=value, now=now)
            members.append({"id": s.id, "name": _display(s), "role": gh_role_of(s), **value})
        members.sort(key=lambda m: m["score"], reverse=True)
        summary = {
            "bajo": sum(1 for m in members if m["classification"] == "Bajo"),
            "medio": sum(1 for m in members if m["classification"] == "Medio"),
            "alto": sum(1 for m in members if m["classification"] == "Alto"),
            "critico": sum(1 for m in members if m["classification"] == "Crítico"),
        }
        return Response(
            {
                "members": members,
                "summary": summary,
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


class TeamRecommendationsView(AnalyticsView):
    """`GET recommendations/team/`: recomendaciones deterministas de
    redistribución de carga de su equipo ejecutor (sin IA)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewRisk]

    def get(self, request):
        members = [
            {"id": s.id, "name": _display(s), "role": gh_role_of(s)}
            for s in access.executor_members(request.user)
        ]
        now = timezone.now()
        recommendations = compute_team_recommendations(members=members, now=now)
        return Response(
            {
                "recommendations": recommendations,
                "prioritized": prioritize_recommendations(recommendations),
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "last_updated": now.isoformat(),
            }
        )


class BenchmarkView(AnalyticsView):
    """`GET benchmarks/<user_id>/`: Benchmark Inteligente (pares del mismo
    cargo del organigrama o Benchmark Personal) y Evolución Personal."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        now = timezone.now()
        benchmark = compute_smart_benchmark(user=target, now=now)
        evolution = compute_personal_evolution(
            user=target, current_score=benchmark["performance"]["value"], now=now
        )
        data_quality = compute_data_quality(user_ids=[target.id])
        if benchmark["mode"] == "cargo":
            reliability_pct = 92
        elif benchmark["mode"] == "cargo-limitado":
            reliability_pct = 68
        else:
            reliability_pct = reliability_pct_from_observations(
                evolution["observations"] if evolution.get("available") else 0
            )
        return Response(
            {
                "benchmark": benchmark,
                "evolution": evolution,
                "confidence": {
                    "data_quality_pct": data_quality["pct"],
                    "reliability_pct": reliability_pct,
                },
                "last_updated": now.isoformat(),
            }
        )


class SimulateKpiView(AnalyticsView):
    """`POST simulate/<user_id>/`: simulador de KPI (8 escenarios). Nunca
    persiste nada. El cuerpo es una unión por `type` validada con
    `is_valid_scenario` (réplica de Nexo)."""

    def post(self, request, user_id: int):
        target = self.target_or_error(user_id)
        body = request.data
        if not is_valid_scenario(body):
            raise AnalyticsError(
                "Escenario inválido.", details={"type": ["Escenario o valores no válidos."]}
            )
        return Response(simulate_kpi_scenario(user=target, body=dict(body), now=timezone.now()))


_VALID_HISTORY_KINDS = {"performance_score", "operational_risk", "health_score"}
_VALID_HISTORY_MONTHS = {1, 3, 6, 12}


class HistoryView(AnalyticsView):
    """`GET history/<user_id>/?kind=&months=`: evolución de un puntaje
    (lectura de `AnalyticsAuditLog`, nunca recalcula). El Riesgo Operativo
    exige además `inteligencia_preventiva.ver`."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        kind_param = request.query_params.get("kind")
        kind = kind_param if kind_param in _VALID_HISTORY_KINDS else "performance_score"
        if kind == "operational_risk" and not access.can(request.user, access.RIESGO_VER):
            raise forbidden("No tiene permiso para ver el Riesgo Operativo.")
        try:
            months_param = int(request.query_params.get("months", ""))
        except ValueError:
            months_param = None
        months = months_param if months_param in _VALID_HISTORY_MONTHS else 3
        points = get_score_series(
            user=target, kind=kind, now=timezone.now(), window_days=months * 31
        )
        return Response({"kind": kind, "months": months, "points": points})


class TargetTimePrecisionView(AnalyticsView):
    """`GET target-time/<user_id>/`: precisión del Tiempo Objetivo del mes."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        now = timezone.now()
        value = compute_target_time_precision(user=target, now=now)
        return Response(
            {**value, "engine_version": ANALYTICS_ENGINE_VERSION, "last_updated": now.isoformat()}
        )


class DataQualityView(AnalyticsView):
    """`GET data-quality/?scope=self|team`: calidad del dato propio o de su
    equipo (`kpi.equipo`)."""

    def get(self, request):
        if request.query_params.get("scope") != "team":
            return Response(compute_data_quality(user_ids=[request.user.id]))
        if not access.can(request.user, access.EQUIPO):
            raise forbidden("No tiene permiso para ver la calidad del dato de su equipo.")
        members = get_team_members(request.user)
        return Response(compute_data_quality(user_ids=[m.id for m in members]))


_CONFIG_KEY_ANALYTICS_ENGINE_VERSION_SEEN = "analytics_engine_version_seen"


class AnalyticsDiagnosticsView(AnalyticsView):
    """`GET diagnostics/?engine_version=X`: calidad del dato de toda la
    empresa y cambio de versión del motor (`kpi.administrar`)."""

    permission_classes = [IsAuthenticated, CanAccess, CanAdminister]

    def get(self, request):
        engine_version = (request.query_params.get("engine_version") or ANALYTICS_ENGINE_VERSION)[
            :20
        ]
        all_user_ids = list(
            User.objects.filter(in_active_company()).distinct().values_list("id", flat=True)
        )
        data_quality = compute_data_quality(user_ids=all_user_ids)
        previous_version = get_effective_config_string(
            _CONFIG_KEY_ANALYTICS_ENGINE_VERSION_SEEN, timezone.now(), ""
        )
        changed = previous_version != engine_version
        if changed:
            set_config_value(
                _CONFIG_KEY_ANALYTICS_ENGINE_VERSION_SEEN, engine_version, request.user
            )
        return Response(
            {
                "data_quality_pct": data_quality["pct"],
                "version_change": {
                    "previous_version": previous_version or None,
                    "changed": changed,
                },
                "engine_version": ANALYTICS_ENGINE_VERSION,
                "formula_set_version": FORMULA_SET_VERSION,
            }
        )


# ── Inteligencia Preventiva (Nexo: /predictive/) ────────────────────────────


class PredictionBundleView(AnalyticsView):
    """`GET predictive/predictions/<user_id>/?as_of=`: predicciones
    explicables (cumplimiento, sobrecarga, estabilidad y retraso de hasta 10
    tareas abiertas)."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        return Response(
            build_prediction_bundle_payload(
                actor=request.user, target=target, now=_parse_as_of(request)
            )
        )


class TrendEngineView(AnalyticsView):
    """`GET predictive/trend/<user_id>/?weeks_back=`: Trend Engine (8
    indicadores). `weeks_back` (1-52) es opcional."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        weeks_back_param = request.query_params.get("weeks_back")
        window_weeks_override = None
        if weeks_back_param is not None:
            try:
                parsed = round_half_up(float(weeks_back_param))
            except (ValueError, OverflowError):
                parsed = None
            if parsed is not None and 0 < parsed <= 52:
                window_weeks_override = parsed
        return Response(
            compute_trend_engine(
                user=target, now=timezone.now(), window_weeks_override=window_weeks_override
            )
        )


class PreventiveAlertsView(AnalyticsView):
    """`GET predictive/alerts/<user_id>/`: alertas preventivas."""

    def get(self, request, user_id: int):
        target = self.target_or_error(user_id)
        return Response({"alerts": compute_preventive_alerts(user=target, now=timezone.now())})


class TeamPreventiveAlertsView(AnalyticsView):
    """`GET predictive/team-alerts/`: alertas preventivas de su equipo y de
    los proyectos activos que ve (`kpi.equipo`)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewTeam]

    def get(self, request):
        members = get_team_members(request.user)
        user_ids = [m.id for m in members]
        project_ids = get_visible_team_project_ids(request.user, user_ids)
        alerts = compute_team_preventive_alerts(
            user_ids=user_ids, project_ids=project_ids, now=timezone.now()
        )
        return Response({"alerts": alerts})


class TeamSubutilizationView(AnalyticsView):
    """`GET predictive/team-subutilization/`: predicción de subutilización
    de cada persona de su equipo (`kpi.equipo`)."""

    permission_classes = [IsAuthenticated, CanAccess, CanViewTeam]

    def get(self, request):
        members = get_team_members(request.user)
        predictions = compute_subutilizacion_predictions(
            user_ids=[m.id for m in members], now=timezone.now()
        )
        return Response(
            {
                "members": [
                    {"user_id": m.id, "name": m.first_name, "prediction": predictions.get(m.id)}
                    for m in members
                ]
            }
        )


def _visible_project(actor, project_id: int):
    """El proyecto si la persona lo ve (la regla de la pantalla de
    Proyectos); si no, 404 sin revelar que existe."""
    from apps.projects.services import ProyectosError, get_visible_project

    try:
        return get_visible_project(actor, project_id)
    except ProyectosError as exc:
        raise not_found("Proyecto no encontrado.") from exc


class ProjectDelayView(AnalyticsView):
    """`GET predictive/project-delay/<project_id>/`: predicción de retraso de
    un proyecto que la persona ve."""

    def get(self, request, project_id: int):
        _visible_project(request.user, project_id)
        return Response(compute_project_delay_prediction(project_id=project_id, now=timezone.now()))


class SimulateAdjustTargetTimeView(AnalyticsView):
    """`POST predictive/simulate/<user_id>/`: escenario «modificar tiempo
    objetivo» de una tarea Pendiente o En progreso. Nunca persiste nada."""

    def post(self, request, user_id: int):
        target = self.target_or_error(user_id)
        data = self.validated(AdjustTargetTimeSimulationSerializer)
        task = (
            Task.objects.filter(pk=data["task_id"])
            .only("assigned_to", "status", "estimated_hours", "target_time_validated", "real_hours")
            .first()
        )
        if not task or task.assigned_to_id != target.id:
            raise not_found("Tarea no encontrada para esta persona.")
        if task.status not in (Task.Status.PENDIENTE, Task.Status.EN_PROGRESO):
            raise AnalyticsError(
                "Solo se puede simular sobre tareas Pendientes o En progreso.",
                details={"task_id": ["La tarea ya está completada."]},
            )
        now = timezone.now()
        capacity = compute_capacity_forecast(user=target, now=now)
        health_score = compute_health_score(user=target, now=now)
        return Response(
            simulate_adjust_target_time(
                capacity=capacity,
                health_score=health_score,
                task=task,
                new_target_time_hours=data["new_target_time_hours"],
            )
        )


class SimulateAddParticipantsView(AnalyticsView):
    """`POST predictive/simulate/project/<project_id>/`: escenario «agregar
    participantes». Nunca persiste nada."""

    def post(self, request, project_id: int):
        project = _visible_project(request.user, project_id)
        data = self.validated(AddParticipantsSimulationSerializer)
        participant_count = project.participants.count()
        return Response(
            simulate_add_participants(
                target_time_hours=project.target_time_hours,
                real_hours=project.real_hours,
                participant_count=participant_count,
                additional_participants=data["additional_participants"],
                project_id=project.id,
            )
        )


class SimulateRedistributeLoadView(AnalyticsView):
    """`POST predictive/simulate/redistribute/`: escenario «redistribuir
    carga» entre dos personas de su ámbito. Nunca persiste nada."""

    def post(self, request):
        data = self.validated(RedistributeLoadSimulationSerializer)
        from_user = ajustes.member_or_404(data["from_user_id"])
        to_user = ajustes.member_or_404(data["to_user_id"])
        if not all(access.can_view_target(request.user, u) for u in (from_user, to_user)):
            raise forbidden("No tiene permiso para ver a estas personas.")
        now = timezone.now()
        capacity_map = compute_team_capacity_forecast(user_ids=[from_user.id, to_user.id], now=now)
        return Response(
            simulate_redistribute_load(
                from_user_id=from_user.id,
                to_user_id=to_user.id,
                from_capacity=capacity_map[from_user.id],
                to_capacity=capacity_map[to_user.id],
                hours=data["hours"],
            )
        )


# ── Ajustes del motor (Nexo: /settings/) ────────────────────────────────────


class SettingsView(AnalyticsView):
    """Leer exige `kpi.acceder`; cambiar, `kpi.administrar`."""

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method not in ("GET", "HEAD", "OPTIONS") and not access.is_admin(request.user):
            self.permission_denied(
                request, message="Solo quien administra el KPI cambia sus ajustes."
            )


class AnalyticsConfigView(SettingsView):
    """`GET/PATCH settings/analytics-config/`: pesos, umbrales y límites."""

    def get(self, request):
        return Response(ajustes.analytics_config_payload())

    def patch(self, request):
        return Response(
            ajustes.update_analytics_config(
                actor=request.user, body=request.data, context=self.context
            )
        )


class WorkloadConfigView(SettingsView):
    """`GET/PUT settings/workload-config/`: límites por día del semáforo."""

    def get(self, request):
        return Response(ajustes.workload_config_payload())

    def put(self, request):
        return Response(
            ajustes.update_workload_config(
                actor=request.user, body=request.data, context=self.context
            )
        )


class PredictionWindowView(SettingsView):
    """`GET/PUT settings/prediction-window/`: ventana histórica de
    Inteligencia Preventiva."""

    def get(self, request):
        return Response(ajustes.prediction_window_payload())

    def put(self, request):
        data = self.validated(PredictionWindowUpdateSerializer)
        return Response(
            ajustes.update_prediction_window(
                actor=request.user, window_weeks=data["window_weeks"], context=self.context
            )
        )


class NormalizationCurvesView(SettingsView):
    """`GET/PATCH settings/normalization-curves/`."""

    def get(self, request):
        return Response(ajustes.curves_payload())

    def patch(self, request):
        data = self.validated(CurveUpdateSerializer)
        return Response(
            ajustes.update_curve(
                actor=request.user, name=data["name"], points=data["points"], context=self.context
            )
        )


class RoleTargetsView(SettingsView):
    """`GET/PATCH settings/role-targets/`: objetivo de referencia por rol."""

    def get(self, request):
        return Response(ajustes.role_targets_payload())

    def patch(self, request):
        data = self.validated(RoleTargetUpdateSerializer)
        return Response(
            ajustes.update_role_target(
                actor=request.user,
                role=data["role"],
                target=dict(data["target"]),
                context=self.context,
            )
        )


class RoleCompatibilityView(SettingsView):
    """`GET/PATCH settings/role-compatibility/`: Matriz de Compatibilidad."""

    def get(self, request):
        return Response(ajustes.role_compatibility_payload())

    def patch(self, request):
        data = self.validated(RoleCompatibilityUpdateSerializer)
        return Response(
            ajustes.update_role_compatibility(
                actor=request.user,
                role=data["role"],
                compatible_roles=data["compatible_roles"],
                context=self.context,
            )
        )


class KpiStartDateView(AnalyticsView):
    """`GET/PATCH settings/kpi-start-date/`: fecha de inicio del KPI de cada
    persona (`kpi.administrar`, como en Nexo solo el ADMINISTRADOR)."""

    permission_classes = [IsAuthenticated, CanAccess, CanAdminister]

    def get(self, request):
        return Response(ajustes.kpi_start_dates_payload())

    def patch(self, request):
        data = self.validated(KpiStartDateUpdateSerializer)
        return Response(
            ajustes.set_kpi_start_date(
                actor=request.user,
                user_id=data["user_id"],
                fecha=data.get("kpi_start_date"),
                context=self.context,
            )
        )
