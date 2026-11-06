"""La interpretación del informe ejecutivo: hallazgos, recomendaciones,
explicación de cada indicador, mapa de riesgo, motivos de consulta, estado del
período y tendencias.

Portado de `apps.reports.insights` de Nexo (que a su vez portaba
`src/lib/reportInsights.ts`). Es una capa de reglas fijas sobre números que ya
calcularon `member_kpis` y el motor de KPI: nunca recalcula un indicador ni usa
IA. `derive_estado_operativo` y `compute_principal_hallazgo` viven en
`member_kpis`, como en Nexo.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model

from apps.analytics.scoring import compute_completed_pct_any
from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    monthly_business_base_for_users,
)
from apps.tasks.business_time import business_calendar_day, business_day_real_range
from apps.tasks.models import MonthClosure, Task, TaskActivity
from apps.tasks.rounding import round_half_up
from apps.tasks.services import get_activity_reason_label_map

from .member_kpis import _month_bounds

User = get_user_model()

__all__ = ["get_activity_reason_label_map"]


# ── Interpretación por indicador ────────────────────────────────────────────


def explain_cumplimiento_indicator(pct: float, member_count: int) -> dict:
    return {
        "meaning": "Porcentaje de tareas del equipo cerradas como Completada sobre el total del período.",
        "why": (
            f"El {pct}% de las tareas de los {member_count} colaboradores incluidos se completaron en el período."
            if pct >= 80
            else f"Solo el {pct}% de las tareas del equipo se completaron — por debajo del objetivo mínimo del 60%."
        ),
        "impact": (
            "El equipo mantiene su capacidad de respuesta y compromisos al día."
            if pct >= 80
            else "Los pendientes acumulados pueden derivar en retrasos operativos si la tendencia continúa."
        ),
        "action": (
            "Mantener el ritmo actual de cierre de tareas."
            if pct >= 80
            else "Priorizar el cierre de tareas próximas a vencer y revisar la carga de quienes están por debajo del objetivo."
        ),
    }


def explain_carga_indicator(pct: float) -> dict:
    return {
        "meaning": "Porcentaje de horas reales registradas por el equipo frente a su base laboral esperada del período.",
        "why": (
            f"El equipo registró {pct}% de su base laboral — por encima del rango óptimo."
            if pct > 100
            else f"El equipo registró {pct}% de su base laboral, dentro o por debajo del rango esperado."
        ),
        "impact": (
            "Una carga sostenida por encima del rango óptimo eleva el riesgo de sobrecarga y desgaste."
            if pct > 100
            else "La carga del equipo no representa un riesgo operativo inmediato."
        ),
        "action": (
            "Redistribuir tareas hacia colaboradores con capacidad disponible."
            if pct > 100
            else "Sin acción requerida — monitorear en el próximo período."
        ),
    }


def explain_consultas_indicator(total: int, prev_total: int | None) -> dict:
    delta_pct = (
        round_half_up(((total - prev_total) / prev_total) * 100)
        if prev_total and prev_total > 0
        else None
    )
    if delta_pct is None:
        why = f"El equipo atendió {total} consultas en el período."
    else:
        variacion = f"un {delta_pct}% más" if delta_pct >= 0 else f"un {abs(delta_pct)}% menos"
        why = f"El equipo atendió {total} consultas, {variacion} que en el período anterior."
    aumento = delta_pct is not None and delta_pct >= 30
    return {
        "meaning": "Total de consultas (actividades tipo Seguimiento) atendidas por el equipo en el período.",
        "why": why,
        "impact": (
            "Un aumento sostenido de consultas puede requerir más capacidad operativa dedicada a atención."
            if aumento
            else "El volumen de consultas se mantiene dentro de lo gestionable por el equipo."
        ),
        "action": (
            "Evaluar si el aumento requiere reforzar el equipo o ajustar procesos."
            if aumento
            else "Sin acción requerida — monitorear en el próximo período."
        ),
    }


# ── Mapa de riesgo (cumplimiento vs. carga) ─────────────────────────────────

RISK_QUADRANT_LABEL: dict[str, str] = {
    "criticos": "Crítico — bajo cumplimiento y sobrecarga",
    "atencion-carga": "Atención — sobrecarga con cumplimiento aceptable",
    "atencion-cumplimiento": "Atención — bajo cumplimiento sin sobrecarga",
    "saludables": "Saludable — cumplimiento y carga dentro de rango",
}


def compute_risk_quadrant(members: list[dict]) -> list[dict]:
    """Cuadrante de cada persona: cumplimiento < 60% es bajo; carga > 100%
    del rango óptimo es sobrecarga (los mismos umbrales que las alertas)."""
    result = []
    for m in members:
        low_cumplimiento = m["completed_pct"] < 60
        high_carga = m["carga_pct"] > 100
        if low_cumplimiento and high_carga:
            quadrant = "criticos"
        elif high_carga:
            quadrant = "atencion-carga"
        elif low_cumplimiento:
            quadrant = "atencion-cumplimiento"
        else:
            quadrant = "saludables"
        result.append({**m, "quadrant": quadrant})
    return result


# ── Distribución por motivo ─────────────────────────────────────────────────

#: Pistas de negocio por motivo del catálogo por defecto; los motivos creados
#: en Ajustes usan el texto genérico.
_REASON_HINT: dict[str, str] = {
    "NOVEDADES_PAGO": "puede indicar un incremento en ajustes de nómina o mayor demanda operativa",
    "RETENCION_PAGO": "puede reflejar casos de retención salarial que requieren seguimiento legal/administrativo",
    "FACTURAS": "puede indicar mayor volumen de gestión documental con proveedores o colaboradores",
    "CONSULTA_OPERACIONES": "sugiere una mayor necesidad de soporte operativo del equipo",
    "SOLICITUD_VACACIONES": "es esperable en períodos de alta demanda de vacaciones",
    "SOLICITUD_PERMISO": "puede indicar mayor ausentismo planificado en el período",
    "VISITA_DOMICILIARIA": "refleja actividad de campo — puede impactar la disponibilidad de quienes las realizan",
    "SEGUIMIENTO_AUSENTISMOS": "sugiere mayor necesidad de gestión de ausentismos en el período",
    "RECLUTAMIENTO_SELECCION": "puede indicar apertura de nuevas vacantes o procesos de selección activos",
    "SEGUIMIENTO_DOCUMENTACION": "puede indicar pendientes documentales acumulados que requieren cierre",
    "SOLICITUDES_INTERNAS": "sugiere mayor demanda de gestión interna del equipo",
}


def explain_motivo_distribution(
    reason_key: str, label: str, pct_of_total: float, trend_pct: float | None
) -> str:
    text = f"{label} representa el {pct_of_total}% de las consultas del período"
    text += (
        ", convirtiéndose en el principal motivo de gestión del equipo."
        if pct_of_total >= 30
        else "."
    )
    hint = _REASON_HINT.get(reason_key)
    if hint:
        text += f" Esto {hint}."
    if trend_pct is not None:
        if trend_pct >= 20:
            text += f" Aumentó {trend_pct}% respecto al período anterior."
        elif trend_pct <= -20:
            text += f" Disminuyó {abs(trend_pct)}% respecto al período anterior."
    return text


# ── Hallazgos y recomendaciones (reglas fijas, sin IA) ──────────────────────


def _nombres(members: list[dict]) -> str:
    return ", ".join(m["name"] for m in members)


def compute_findings(
    *,
    avg_cumplimiento: float,
    avg_cumplimiento_delta: float | None,
    members: list[dict],
    total_overdue: int,
    top_reason: dict | None,
) -> list[dict]:
    """`top_reason`: `{"label", "pct"}` del motivo más frecuente, o None."""
    findings: list[dict] = []

    if avg_cumplimiento_delta is not None:
        d = avg_cumplimiento_delta
        if d >= 3:
            findings.append(
                {
                    "text": f"El cumplimiento del equipo aumentó {d} puntos porcentuales respecto al mes anterior.",
                    "tone": "positive",
                }
            )
        elif d <= -3:
            findings.append(
                {
                    "text": f"El cumplimiento del equipo disminuyó {abs(d)} puntos porcentuales respecto al mes anterior.",
                    "tone": "risk",
                }
            )

    subutilizados = [m for m in members if m["carga_label"] == "Subutilización"]
    sobrecargados = [m for m in members if m["carga_label"] == "Sobrecarga"]
    if subutilizados:
        findings.append(
            {
                "text": f"Existen {len(subutilizados)} colaborador(es) subutilizados: {_nombres(subutilizados)}.",
                "tone": "neutral",
            }
        )
    if sobrecargados:
        findings.append(
            {
                "text": f"Existen {len(sobrecargados)} colaborador(es) en sobrecarga: {_nombres(sobrecargados)}.",
                "tone": "risk",
            }
        )
    else:
        findings.append(
            {
                "text": "La carga general del equipo es adecuada — nadie está en sobrecarga este período.",
                "tone": "positive",
            }
        )

    if total_overdue == 0:
        findings.append(
            {"text": "No existen tareas vencidas en el equipo este período.", "tone": "positive"}
        )
    else:
        findings.append(
            {"text": f"Existen {total_overdue} tarea(s) vencida(s) en el equipo.", "tone": "risk"}
        )

    if top_reason and top_reason["pct"] >= 30:
        findings.append(
            {
                "text": f"\"{top_reason['label']}\" concentra el {top_reason['pct']}% de las consultas del período.",
                "tone": "neutral",
            }
        )
    return findings


def compute_recommendations(
    *, avg_cumplimiento: float, members: list[dict], top_reason: dict | None
) -> list[dict]:
    """El `id` es estable por regla: la fase de IA enriquecerá esta lista 1:1
    por id, sin poder inventar recomendaciones nuevas."""
    recs: list[dict] = []
    subutilizados = [m for m in members if m["carga_label"] == "Subutilización"]
    sobrecargados = [m for m in members if m["carga_label"] == "Sobrecarga"]
    bajo_cumplimiento = [m for m in members if m["completed_pct"] < 60]

    if sobrecargados and subutilizados:
        recs.append(
            {
                "id": "redistribuir-carga-mixta",
                "text": f"Redistribuir carga: {_nombres(sobrecargados)} está(n) en sobrecarga mientras {_nombres(subutilizados)} tiene(n) capacidad disponible.",
                "priority": "alta",
            }
        )
    elif sobrecargados:
        recs.append(
            {
                "id": "redistribuir-carga-sobrecarga",
                "text": f"Redistribuir carga de {_nombres(sobrecargados)} hacia colaboradores con capacidad disponible.",
                "priority": "alta",
            }
        )

    if bajo_cumplimiento:
        recs.append(
            {
                "id": "revisar-bajo-cumplimiento",
                "text": f"Revisar proyectos/tareas de {_nombres(bajo_cumplimiento)} — cumplimiento por debajo del 60%.",
                "priority": "alta",
            }
        )

    if top_reason and top_reason["pct"] >= 30:
        recs.append(
            {
                "id": "reforzar-motivo-concentrado",
                "text": f"Evaluar capacitar o reforzar el proceso de \"{top_reason['label']}\" — concentra {top_reason['pct']}% de las consultas del equipo.",
                "priority": "media",
            }
        )

    if not sobrecargados and not bajo_cumplimiento and avg_cumplimiento >= 80:
        recs.append(
            {
                "id": "mantener-planificacion",
                "text": "Mantener la planificación actual — los indicadores del equipo están dentro de rangos saludables.",
                "priority": "media",
            }
        )
    return recs


def compute_team_insights(
    *,
    members: list[dict],
    total_carga_real_hours: float,
    health_by_member: list[dict] | None = None,
    variable_consistency_members: list[str] | None = None,
) -> list[str]:
    """`health_by_member`: `{"name", "score"}` (Equilibrio Operativo, solo mes
    en curso)."""
    insights: list[str] = []

    if total_carga_real_hours > 0 and members:
        top = max(members, key=lambda m: m["carga_real_hours"])
        pct = round_half_up((top["carga_real_hours"] / total_carga_real_hours) * 100)
        if pct >= 20:
            insights.append(
                f"{top['name']} concentró el {pct}% del tiempo ejecutado por el equipo este período."
            )

    if health_by_member:
        best = max(health_by_member, key=lambda m: m["score"])
        insights.append(
            f"{best['name']} mantiene el mayor Equilibrio Operativo del equipo ({best['score']}/100)."
        )

    for name in (variable_consistency_members or [])[:2]:
        insights.append(f"{name} presenta variaciones importantes entre semanas.")
    return insights


# ── Período anterior equivalente y estado del período ──────────────────────


def previous_equivalent_period(period_start: datetime, period_end: datetime) -> dict:
    """El período de igual duración que termina justo antes de `period_start`
    (para la tendencia de los motivos en cualquier largo de período)."""
    duration = period_end - period_start
    end = period_start - timedelta(microseconds=1)
    return {"start": end - duration, "end": end}


def resolve_monthly_period_status(month: int, year: int, now: datetime | None = None) -> str:
    """EN_CURSO si es el mes en curso; si no, CERRADO con cierre de mes o
    HISTORICO sin él. El «mes en curso» es el del negocio (America/
    Guayaquil), como lo calculaba el constructor de Nexo en su servidor."""
    now = now or datetime.now(dt_timezone.utc)
    hoy = business_calendar_day(now)
    if month == hoy.month and year == hoy.year:
        return "EN_CURSO"
    return (
        "CERRADO" if MonthClosure.objects.filter(month=month, year=year).exists() else "HISTORICO"
    )


def resolve_custom_range_period_status(period_end: datetime, now: datetime | None = None) -> str:
    """Un rango de días no es un mes calendario: nunca CERRADO."""
    now = now or datetime.now(dt_timezone.utc)
    return "HISTORICO" if period_end < now else "EN_CURSO"


# ── Tendencias (mes anterior, trimestre, semestre) ──────────────────────────

_MONTH_NAMES_SHORT = [
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


def compute_team_monthly_snapshots(
    user_ids: list[int], end_year: int, end_month: int, months_back: int
) -> list[dict]:
    """Cumplimiento, carga y consultas del equipo en el mes del informe y los
    `months_back` anteriores (más antiguo primero), para las tarjetas de
    tendencia del informe MENSUAL."""
    if not user_ids:
        return []

    months: list[tuple[int, int]] = []
    for i in range(months_back + 1):
        y, m = end_year, end_month - (months_back - i)
        while m < 1:
            m += 12
            y -= 1
        months.append((y, m))

    range_start, _ = _month_bounds(*months[0])
    _, range_end = _month_bounds(*months[-1])

    users = list(User.objects.filter(id__in=user_ids))
    month_business_info = []
    for year, month in months:
        biz = monthly_business_base_for_users(users, year, month)
        shared = biz["shared"]
        real_start, _ = business_day_real_range(shared["start"])
        _, real_end = business_day_real_range(shared["end"])
        month_business_info.append(
            {
                "year": year,
                "month": month,
                "shared": shared,
                "real_start": real_start,
                "real_end": real_end,
                "per_user": biz["per_user"],
            }
        )

    range_real_start = month_business_info[0]["real_start"]
    range_real_end = month_business_info[-1]["real_end"]
    all_tasks = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids, end_date__gte=range_start, end_date__lte=range_end
        ).only("assigned_to_id", "status", "end_date")
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=range_start,
            created_at__lte=range_end,
            task__type=Task.Type.SEGUIMIENTO,
        ).only("author_id", "created_at")
    )
    fija_tasks = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids,
            type=Task.Type.FIJA,
            completed_at__gte=range_real_start,
            completed_at__lte=range_real_end,
        ).only("assigned_to_id", "real_hours", "completed_at")
    )
    carga_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=range_real_start,
            created_at__lte=range_real_end,
        ).only("author_id", "duration", "created_at")
    )

    result: list[dict] = []
    for biz_info in month_business_info:
        year, month = biz_info["year"], biz_info["month"]
        start, end = _month_bounds(year, month)
        real_start, real_end = biz_info["real_start"], biz_info["real_end"]
        month_tasks = [t for t in all_tasks if start <= t.end_date <= end]
        month_acts = [a for a in all_activities if start <= a.created_at <= end]
        month_fija = [t for t in fija_tasks if real_start <= t.completed_at <= real_end]
        month_carga = [a for a in carga_activities if real_start <= a.created_at <= real_end]

        member_stats = []
        for user_id in user_ids:
            tasks = [t for t in month_tasks if t.assigned_to_id == user_id]
            fija_hours = sum(t.real_hours for t in month_fija if t.assigned_to_id == user_id)
            activity_hours = sum(a.duration for a in month_carga if a.author_id == user_id) / 60
            carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
            user_biz = biz_info["per_user"].get(user_id, biz_info["shared"])
            carga_range = compute_workload_range(
                carga_real_hours,
                user_biz["limit_base_hours"],
                user_biz["limit_low_hours"],
                user_biz["limit_high_hours"],
                user_biz["limit_overload_hours"],
            )
            member_stats.append(
                {
                    "completed_pct": compute_completed_pct_any(tasks),
                    "carga_pct": compute_workload_pct(
                        carga_real_hours, user_biz["limit_base_hours"], carga_range["max"]
                    ),
                    "total_tasks": len(tasks),
                }
            )

        activos = [m for m in member_stats if m["total_tasks"] > 0]
        avg_cumplimiento = (
            round_half_up(sum(m["completed_pct"] for m in activos) / len(activos)) if activos else 0
        )
        # A diferencia del cumplimiento (solo quienes tuvieron tareas), la
        # carga promedia a TODO el roster: asimetría real de Nexo.
        avg_carga_pct = (
            round_half_up(sum(m["carga_pct"] for m in member_stats) / len(member_stats))
            if member_stats
            else 0
        )
        result.append(
            {
                "month": f"{year:04d}-{month:02d}",
                "label": f"{_MONTH_NAMES_SHORT[month - 1]} {year % 100:02d}",
                "avg_cumplimiento": avg_cumplimiento,
                "avg_carga_pct": avg_carga_pct,
                "total_consultas": len(month_acts),
                "total_tasks": len(month_tasks),
            }
        )
    return result


def _classify_delta(delta: float) -> str:
    if delta >= 5:
        return "mejora"
    if delta <= -5:
        return "deterioro"
    return "estable"


def compute_trend_comparisons(points: list[dict]) -> dict:
    """Las tres comparaciones del cumplimiento del mes (el último punto) con
    el mes anterior, el trimestre y el semestre previos."""
    current_value = points[-1]["avg_cumplimiento"] if points else 0

    def comparison_from(label: str, window: list[dict]) -> dict:
        with_data = [p for p in window if p["total_tasks"] > 0]
        if not with_data:
            return {
                "label": label,
                "current_value": current_value,
                "compare_value": None,
                "delta": None,
                "direction": "sin-datos",
            }
        compare_value = round_half_up(
            sum(p["avg_cumplimiento"] for p in with_data) / len(with_data)
        )
        delta = current_value - compare_value
        return {
            "label": label,
            "current_value": current_value,
            "compare_value": compare_value,
            "delta": delta,
            "direction": _classify_delta(delta),
        }

    prior = points[:-1]
    return {
        "mes_anterior": comparison_from("Mes anterior", prior[-1:]),
        "trimestre": comparison_from("Trimestre (prom. 3 meses)", prior[-3:]),
        "semestre": comparison_from("Semestre (prom. 6 meses)", prior[-6:]),
    }
