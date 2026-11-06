"""Construcción del documento de un informe ejecutivo (`ExecutiveReportSnapshotData`).

En Nexo esto vivía en el frontend (`src/lib/executiveReporting/
buildSnapshotData.ts`), que pedía a Django los agregados por HTTP y armaba el
documento en Next.js. Aquí todo ocurre en el servidor, en una sola pasada:

1. El agregado de equipo (`team_report`) del tipo pedido.
2. Solo en el MENSUAL del mes en curso: el Índice Ejecutivo (Performance Score
   y Equilibrio Operativo de cada persona, del motor de KPI), el Analytics
   Predictivo (proyección de cumplimiento, sobrecarga y subutilización) y,
   sin fecha de corte explícita, la validación de integridad contra el KPI del
   equipo.
3. Estado operativo, hallazgo principal e insights de cada persona con el
   Equilibrio Operativo ya conocido.
4. Los metadatos (Report ID, período, corte, cierre, versiones, quién y
   cuándo) y la narrativa determinista (`narrativa.py`).

El documento sale en camelCase —la forma exacta que tenía en Nexo, la que
el bridge `deepCamelCase` producía—: así un informe generado aquí y uno
importado de Nexo se leen igual en el visor y en el Excel.

Diferencias con Nexo (las fórmulas no cambian):

- **Ids.** En el MENSUAL del mes en curso, Nexo comparaba el id del roster
  (texto) con el de cada persona (número) y nunca coincidían: el Equilibrio
  Operativo no llegaba a `members[].equilibrioScore`, ni a los insights, ni el
  nombre a la página predictiva. Aquí los ids son siempre enteros y sí se
  enlazan, que era lo que Nexo pretendía.
- **«Mes en curso»** es el del negocio (America/Guayaquil, `business_calendar_day`),
  como lo calculaba Next.js en su servidor.
- **Variación del Índice Ejecutivo.** Nexo la tomaba del `MonthlyReport`
  antiguo, que estaba vacío (siempre null). Aquí sale del último informe
  MENSUAL del mes anterior con las mismas personas que traiga Índice
  Ejecutivo (es decir, generado durante ese mes); si no hay, null.
"""

import logging
import secrets
import time
from datetime import UTC, date, datetime, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model

from apps.analytics.health_score import compute_health_score
from apps.analytics.history import compute_consistency
from apps.analytics.models import ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION
from apps.analytics.performance_score import compute_performance_score
from apps.analytics.prediction_engine import (
    compute_cumplimiento_projection,
    compute_sobrecarga_probability,
    compute_subutilizacion_predictions,
)
from apps.analytics.services import build_team_kpi_rows
from apps.analytics.workload import get_month_closure_period
from apps.tasks.business_time import BUSINESS_TZ_OFFSET_HOURS, business_calendar_day
from apps.tasks.rounding import round_half_up

from .insights import compute_team_insights
from .member_kpis import (
    _local_month_bounds,
    _month_bounds,
    compute_principal_hallazgo,
    derive_estado_operativo,
    month_label,
    resolve_closure_cutoff,
)
from .models import ExecutiveReportSnapshot
from .narrativa import NOVA_DETERMINISTA, classify_indice_ejecutivo, narrativa_determinista
from .team_report import (
    assemble_custom_range_team_report,
    assemble_monthly_team_report,
    assemble_range_team_report,
)

User = get_user_model()
logger = logging.getLogger("apps.informes")

#: Versión del motor de informes (la de Nexo: el Executive Reporting Engine 2.0).
REPORTING_ENGINE_VERSION = "2.0"

#: Tolerancia de la validación de integridad, en puntos porcentuales.
TOLERANCIA_INTEGRIDAD = 0.5

# Alfabeto del sufijo del Report ID sin 0/O/1/I: se lee impreso sin ambigüedad.
_ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

_MESES_CORTOS = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
]


# ── Utilidades ──────────────────────────────────────────────────────────────


def generate_report_id(now: datetime) -> str:
    """NXR-YYYYMMDD-HHMMSS-XXXX, con la hora del negocio (UTC-5): la que
    reconoce quien lo generó. La unicidad la garantiza la base; el sufijo
    aleatorio solo hace la colisión improbable."""
    local = now.astimezone(UTC) - timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)
    sufijo = "".join(secrets.choice(_ALFABETO) for _ in range(4))
    return f"NXR-{local:%Y%m%d-%H%M%S}-{sufijo}"


def versiones() -> dict:
    return {
        "analyticsEngineVersion": ANALYTICS_ENGINE_VERSION,
        "formulaSetVersion": FORMULA_SET_VERSION,
        "reportingEngineVersion": REPORTING_ENGINE_VERSION,
        # En Nexo, la versión de Nexo; aquí, la de la intranet.
        "nexoVersion": str(getattr(settings, "APP_VERSION", "") or "—"),
    }


def _snake_a_camel(clave: str) -> str:
    partes = clave.split("_")
    return partes[0] + "".join(p[:1].upper() + p[1:] for p in partes[1:])


def camel(valor):
    """`deepCamelCase` del bridge de Nexo: las claves de texto a camelCase,
    en profundidad. Las claves numéricas (ids) no cambian."""
    if isinstance(valor, list):
        return [camel(v) for v in valor]
    if isinstance(valor, dict):
        return {
            (_snake_a_camel(k) if isinstance(k, str) else k): camel(v) for k, v in valor.items()
        }
    if isinstance(valor, datetime | date):
        return valor.isoformat()
    return valor


def _iso(instante: datetime) -> str:
    return instante.astimezone(UTC).isoformat().replace("+00:00", "Z")


def closure_meta(closure) -> dict | None:
    """Los datos del cierre de mes, copiados tal cual de `MonthClosure`."""
    if closure is None:
        return None
    return {
        "closureType": closure.closure_type,
        "cutoffDate": _iso(closure.cutoff_date),
        "closedAt": _iso(closure.closed_at),
        "calendarDaysTotal": closure.calendar_days_total,
        "calendarDaysConsidered": closure.calendar_days_considered,
        "workingDaysConsidered": closure.working_days_considered,
        "workingHoursConsidered": closure.working_hours_considered,
    }


def es_mes_en_curso(year: int, month: int, now: datetime) -> bool:
    hoy = business_calendar_day(now)
    return (year, month) == (hoy.year, hoy.month)


# ── Índice Ejecutivo (solo el mes en curso) ─────────────────────────────────


def _rendimiento_y_equilibrio(user_ids: list[int], now: datetime) -> dict[int, dict]:
    """Performance Score y Equilibrio Operativo de cada persona (en Nexo,
    `GET /analytics/<id>/`). Quien falla se excluye del promedio sin tumbar la
    generación, como en Nexo."""
    resultados: dict[int, dict] = {}
    for user in User.objects.filter(id__in=user_ids):
        try:
            consistencia = compute_consistency(user=user, now=now)
            salud = compute_health_score(user=user, now=now, precomputed_consistency=consistencia)
            rendimiento = compute_performance_score(
                user=user, now=now, precomputed_consistency=consistencia
            )
        except Exception:  # noqa: BLE001 — un colaborador no tumba el informe
            logger.exception("[informes] no se pudo calcular el índice de %s", user.pk)
            continue
        resultados[user.id] = {
            "performance": rendimiento["score"],
            "health": salud["score"],
            "factors": salud["factors"],
        }
    return resultados


def variacion_del_indice(
    valor: float, year: int, month: int, collaborator_ids: list[int]
) -> float | None:
    """La variación contra el informe MENSUAL del mes anterior con las mismas
    personas y con Índice Ejecutivo (solo lo tiene uno generado durante ese
    mes). En Nexo salía del `MonthlyReport` antiguo, siempre vacío."""
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    inicio, _ = _month_bounds(prev_year, prev_month)
    # Como texto: un informe importado puede traer «nexo:<id>» entre sus ids.
    buscados = sorted(map(str, collaborator_ids))
    candidatos = ExecutiveReportSnapshot.objects.filter(
        type=ExecutiveReportSnapshot.Type.MENSUAL, period_start=inicio
    ).order_by("-generated_at")
    for snap in candidatos.only("collaborator_ids", "data"):
        if sorted(map(str, snap.collaborator_ids or [])) != buscados:
            continue
        indice = ((snap.data or {}).get("estadoGeneral") or {}).get("indiceEjecutivo")
        if isinstance(indice, dict) and isinstance(indice.get("valor"), int | float):
            return round_half_up((valor - indice["valor"]) * 10) / 10
    return None


def _promedio_1(valores: list[float]) -> float:
    return round_half_up((sum(valores) / len(valores)) * 10) / 10 if valores else 0


# ── Analytics Predictivo (solo el mes en curso) ─────────────────────────────


def _prediccion(resultado: dict | None, con_nivel: bool) -> dict:
    if resultado and resultado.get("available"):
        salida = {
            "available": True,
            "queOcurrira": resultado["que_ocurrira"],
            "porQue": resultado["por_que"],
            "queHacer": resultado["que_hacer"],
            "confidencePct": resultado["confidence_pct"],
        }
        if con_nivel:
            salida["nivel"] = resultado["nivel"]
        return salida
    salida = {
        "available": False,
        "queOcurrira": (resultado or {}).get("reason") or "Sin datos disponibles.",
        "porQue": "",
        "queHacer": [],
        "confidencePct": 0,
    }
    if con_nivel:
        salida["nivel"] = "Bajo"
    return salida


def construir_predictivo(user_ids: list[int], nombres: dict[int, str], cutoff: datetime) -> dict:
    """Proyección por persona desde la fecha de corte (`predictionEngine`),
    con el resumen del equipo (`buildPredictivoForCurrentMonth`)."""
    usuarios = {u.id: u for u in User.objects.filter(id__in=user_ids)}
    subutilizacion = compute_subutilizacion_predictions(user_ids=user_ids, now=cutoff)
    bundles = {}
    for uid in user_ids:
        user = usuarios.get(uid)
        if user is None:
            continue
        bundles[uid] = {
            "cumplimiento": compute_cumplimiento_projection(user=user, now=cutoff),
            "sobrecarga": compute_sobrecarga_probability(user=user, now=cutoff),
        }

    miembros = []
    for uid in user_ids:
        bundle = bundles.get(uid) or {}
        sub = subutilizacion.get(uid)
        miembros.append(
            {
                "id": uid,
                "name": nombres.get(uid, str(uid)),
                "cumplimiento": _prediccion(bundle.get("cumplimiento"), con_nivel=False),
                "sobrecarga": _prediccion(bundle.get("sobrecarga"), con_nivel=True),
                "subutilizacion": (
                    {
                        "nivel": sub["nivel"],
                        "queOcurrira": sub["que_ocurrira"],
                        "queHacer": sub["que_hacer"],
                    }
                    if sub
                    else None
                ),
            }
        )

    validos = [
        b["cumplimiento"]["cumplimiento_esperado_cierre_pct"]
        for b in bundles.values()
        if b["cumplimiento"].get("available")
    ]
    horizonte = next(
        (
            b["cumplimiento"]["horizon"]
            for b in bundles.values()
            if b["cumplimiento"].get("available")
        ),
        None,
    ) or next(
        (b["sobrecarga"]["horizon"] for b in bundles.values() if b["sobrecarga"].get("available")),
        None,
    )
    return {
        "asOf": _iso(cutoff),
        "horizonDays": horizonte or 30,
        "membersAtRiskSobrecarga": sum(
            1
            for b in bundles.values()
            if b["sobrecarga"].get("available") and b["sobrecarga"].get("nivel") == "Alto"
        ),
        "avgCumplimientoEsperadoCierrePct": (
            round_half_up(sum(validos) / len(validos)) if validos else None
        ),
        "members": miembros,
    }


# ── Validación de integridad (`verifySnapshotIntegrity.ts`) ─────────────────


def verificar_integridad(*, actor, year: int, month: int, members: list[dict], now: datetime):
    """Compara cumplimiento y carga de cada persona con el KPI del equipo
    (`kpis/team/`, `build_team_kpi_rows`) para el mismo mes. Devuelve
    `(resultado, incidentes)`; nunca lanza: si la comparación no se puede
    hacer, `performed` es False (no significa que haya diferencias)."""
    try:
        filas = build_team_kpi_rows(actor=actor, year=year, month=month, now=now)
    except Exception:  # noqa: BLE001 — la validación nunca bloquea el informe
        return {"performed": False, "discrepancyCount": 0}, []
    por_id = {fila["id"]: fila for fila in filas}
    incidentes = []
    for m in members:
        fila = por_id.get(m["id"])
        if fila is None:
            continue
        for campo, esperado, real in (
            ("completedPct", m["completed_pct"], fila["completed_pct"]),
            ("cargaPct", m["carga_pct"], fila["carga_pct"]),
        ):
            if abs(esperado - real) > TOLERANCIA_INTEGRIDAD:
                incidentes.append(
                    {
                        "field_path": f"members[{m['id']}].{campo}",
                        "expected_value": float(esperado),
                        "actual_value": float(real),
                        "user_id": m["id"],
                    }
                )
    return {"performed": True, "discrepancyCount": len(incidentes)}, incidentes


# ── Ensamblado común ────────────────────────────────────────────────────────


def _documento(
    *,
    bundle: dict,
    meta: dict,
    trends=None,
    monthly_evolution=None,
    range_trend=None,
    problematic_months=None,
    indice=None,
    predictivo=None,
    integrity_check=None,
) -> dict:
    doc = {
        "meta": meta,
        "estadoGeneral": {"indiceEjecutivo": indice, "dataQuality": camel(bundle["data_quality"])},
        "teamSummary": camel(bundle["team_summary"]),
        "members": camel(bundle["members"]),
        "ranking": camel(bundle["ranking"]),
        "distribuciones": camel(bundle["distribuciones"]),
        "trends": camel(trends) if trends is not None else None,
        "monthlyEvolution": monthly_evolution,
        "rangeTrend": camel(range_trend) if range_trend is not None else None,
        "problematicMonths": camel(problematic_months) if problematic_months is not None else None,
        "findings": bundle["findings"],
        "insights": bundle["insights"],
        "indicatorExplanations": bundle["indicator_explanations"],
        "recommendations": bundle["recommendations"],
        "alerts": camel(bundle["alerts"]),
        "predictivo": predictivo,
        "nova": None,
        "novaDegraded": False,
        "novaOrigen": NOVA_DETERMINISTA,
        "integrityCheck": integrity_check,
    }
    doc["nova"] = narrativa_determinista(doc)
    return doc


def _meta(
    *,
    report_id,
    tipo,
    roster,
    period_label,
    period_start,
    period_end,
    cutoff,
    period_status,
    closure,
    generated_by,
    now,
    t0,
) -> dict:
    return {
        "reportId": report_id,
        "origin": ExecutiveReportSnapshot.Origin.GENERATED.value,
        "integrityFlag": ExecutiveReportSnapshot.Integrity.FULL.value,
        "type": tipo,
        "rosterKind": roster["roster_kind"],
        "scope": str(roster["scope"]),
        "periodLabel": period_label,
        "periodStart": _iso(period_start),
        "periodEnd": _iso(period_end),
        "fechaCorte": _iso(cutoff),
        "periodStatus": period_status,
        "closure": closure,
        "collaboratorIds": list(roster["user_ids"]),
        "collaboratorCount": len(roster["user_ids"]),
        "generatedBy": {
            "userId": generated_by.pk,
            "name": generated_by.first_name or generated_by.username,
        },
        "generatedAt": _iso(now),
        # Se fija al terminar (`generationMs` incluye la narrativa).
        "generationMs": int((time.monotonic() - t0) * 1000),
        "versions": versiones(),
    }


# ── MENSUAL ─────────────────────────────────────────────────────────────────


def build_monthly(*, actor, roster: dict, year: int, month: int, fecha_corte, now, report_id):
    """Devuelve `(documento, incidentes)`."""
    t0 = time.monotonic()
    user_ids = roster["user_ids"]
    start, end = _month_bounds(year, month)
    cutoff = resolve_closure_cutoff(year, month, fecha_corte, end, now)
    closure, _natural, _efectivo = get_month_closure_period(year, month)

    bundle = assemble_monthly_team_report(
        user_ids=user_ids, year=year, month=month, explicit_fecha_corte=fecha_corte, now=now
    )
    members = bundle["members"]
    nombres = {m["id"]: m["name"] for m in members}

    indice = predictivo = integrity_check = None
    incidentes: list[dict] = []
    variables: list[str] = []
    en_curso = es_mes_en_curso(year, month, now)
    if en_curso and user_ids:
        resultados = _rendimiento_y_equilibrio(user_ids, now)
        avg_perf = _promedio_1([r["performance"] for r in resultados.values()])
        avg_equi = _promedio_1([r["health"] for r in resultados.values()])
        clasificado = classify_indice_ejecutivo(avg_perf, avg_equi)
        indice = {
            **clasificado,
            "avgPerformance": avg_perf,
            "avgEquilibrio": avg_equi,
            "variacion": variacion_del_indice(clasificado["valor"], year, month, user_ids),
        }
        predictivo = construir_predictivo(user_ids, nombres, cutoff)
        if fecha_corte is None:
            integrity_check, incidentes = verificar_integridad(
                actor=actor, year=year, month=month, members=members, now=now
            )
        for m in members:
            resultado = resultados.get(m["id"])
            if resultado is None:
                continue
            m["equilibrio_score"] = resultado["health"]
            consistencia = next(
                (f for f in resultado["factors"] if f["name"] == "Consistencia"), None
            )
            if consistencia and consistencia["raw_label"] in ("Variable", "Muy variable"):
                variables.append(m["name"])

    for m in members:
        m["estado_operativo"] = derive_estado_operativo(
            completed_pct=m["completed_pct"],
            carga_label=m["carga_label"],
            overdue_count=m["overdue_count"],
            equilibrio_score=m.get("equilibrio_score"),
        )
        m["principal_hallazgo"] = compute_principal_hallazgo(
            carga_label=m["carga_label"],
            completed_pct=m["completed_pct"],
            overdue_count=m["overdue_count"],
            total_tasks=m["total_tasks"],
            consistency_variable=m["name"] in variables,
        )
    bundle["insights"] = compute_team_insights(
        members=members,
        total_carga_real_hours=bundle["team_summary"]["total_carga_real_hours"],
        health_by_member=(
            [
                {"name": m["name"], "score": m["equilibrio_score"]}
                for m in members
                if "equilibrio_score" in m
            ]
            if en_curso
            else None
        ),
        variable_consistency_members=variables,
    )

    meta = _meta(
        report_id=report_id,
        tipo=ExecutiveReportSnapshot.Type.MENSUAL.value,
        roster=roster,
        period_label=month_label(year, month),
        period_start=start,
        period_end=end,
        cutoff=cutoff,
        period_status=bundle["period_status"],
        closure=closure_meta(closure),
        generated_by=actor,
        now=now,
        t0=t0,
    )
    doc = _documento(
        bundle=bundle,
        meta=meta,
        trends=bundle["trends"],
        indice=indice,
        predictivo=predictivo,
        integrity_check=integrity_check,
    )
    doc["meta"]["generationMs"] = int((time.monotonic() - t0) * 1000)
    return doc, incidentes


# ── RANGO DE MESES ──────────────────────────────────────────────────────────


def build_range(*, actor, roster: dict, desde: tuple, hasta: tuple, fecha_corte, now, report_id):
    t0 = time.monotonic()
    (from_year, from_month), (to_year, to_month) = desde, hasta
    range_start, _ = _local_month_bounds(from_year, from_month)
    _, range_end = _local_month_bounds(to_year, to_month)
    cutoff = resolve_closure_cutoff(to_year, to_month, fecha_corte, range_end, now)
    closure, _natural, _efectivo = get_month_closure_period(to_year, to_month)

    bundle = assemble_range_team_report(
        user_ids=roster["user_ids"],
        from_year=from_year,
        from_month=from_month,
        to_year=to_year,
        to_month=to_month,
        explicit_fecha_corte=fecha_corte,
        now=now,
    )
    identidad = {m["id"]: m for m in bundle["members"]}
    # Como el glue de Nexo: `member_snapshots` pasa de `{id: {...}}` a una lista
    # con id, nombre y rol, sin vencidas ni horas (que no se muestran por mes).
    evolucion = [
        {
            "month": ms["month"],
            "label": ms["label"],
            "teamAvgCumplimiento": ms["team_avg_cumplimiento"],
            "totalCompletedTasks": ms["total_completed_tasks"],
            "totalTasks": ms["total_tasks"],
            "totalCargaRealHours": ms["total_carga_real_hours"],
            "totalCargaBaseHours": ms["total_carga_base_hours"],
            "totalConsultas": ms["total_consultas"],
            "memberSnapshots": [
                {
                    "id": uid,
                    "name": (identidad.get(uid) or {}).get("name", ""),
                    "role": (identidad.get(uid) or {}).get("role", ""),
                    "completedPct": snap["completed_pct"],
                    "cargaPct": snap["carga_pct"],
                    "cargaColor": snap["carga_color"],
                    "cargaLabel": snap["carga_label"],
                    "score": snap["score"],
                    "totalTasks": snap["total_tasks"],
                }
                for uid, snap in ms["member_snapshots"].items()
            ],
        }
        for ms in bundle["monthly_evolution"]
    ]

    meta = _meta(
        report_id=report_id,
        tipo=ExecutiveReportSnapshot.Type.RANGO_MESES.value,
        roster=roster,
        period_label=f"{month_label(from_year, from_month)} a {month_label(to_year, to_month)}",
        period_start=range_start,
        period_end=range_end,
        cutoff=cutoff,
        period_status=bundle["period_status"],
        closure=closure_meta(closure),
        generated_by=actor,
        now=now,
        t0=t0,
    )
    doc = _documento(
        bundle=bundle,
        meta=meta,
        monthly_evolution=evolucion,
        range_trend=bundle["range_trend"],
        problematic_months=bundle["problematic_months"],
    )
    doc["meta"]["generationMs"] = int((time.monotonic() - t0) * 1000)
    return doc, []


# ── RANGO PERSONALIZADO ─────────────────────────────────────────────────────


def _dia_corto(d: date) -> str:
    return f"{d.day:02d} {_MESES_CORTOS[d.month - 1]} {d.year}"


def build_custom_range(
    *, actor, roster: dict, desde: date, hasta: date, fecha_corte, now, report_id
):
    t0 = time.monotonic()
    # Del inicio del primer día al último instante del último, en UTC
    # (`parseDayUTC` de Nexo).
    period_start = datetime(desde.year, desde.month, desde.day, tzinfo=UTC)
    period_end = datetime(hasta.year, hasta.month, hasta.day, tzinfo=UTC) + timedelta(
        days=1, microseconds=-1
    )
    cutoff = min(fecha_corte, now) if fecha_corte else min(period_end, now)

    bundle = assemble_custom_range_team_report(
        user_ids=roster["user_ids"],
        period_start=period_start,
        period_end=period_end,
        explicit_fecha_corte=fecha_corte,
        now=now,
    )
    meta = _meta(
        report_id=report_id,
        tipo=ExecutiveReportSnapshot.Type.RANGO_PERSONALIZADO.value,
        roster=roster,
        period_label=f"{_dia_corto(desde)} — {_dia_corto(hasta)}",
        period_start=period_start,
        period_end=period_end,
        cutoff=cutoff,
        period_status=bundle["period_status"],
        # Un rango de días no es un mes: no hay un cierre que atribuirle.
        closure=None,
        generated_by=actor,
        now=now,
        t0=t0,
    )
    doc = _documento(bundle=bundle, meta=meta)
    doc["meta"]["generationMs"] = int((time.monotonic() - t0) * 1000)
    return doc, []
