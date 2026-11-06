"""El agregado de equipo de un informe ejecutivo, para cada uno de los tres
tipos: resumen, ranking, distribuciones, tendencias, hallazgos, explicación de
indicadores, recomendaciones, alertas y calidad del dato.

Portado de `apps.reports.team_report` de Nexo: `member_kpis` CALCULA,
`insights` INTERPRETA y este módulo ENSAMBLA. Lo que en Nexo quedaba fuera de
este agregado (el Índice Ejecutivo, el Analytics Predictivo, la narrativa y
los metadatos del informe) lo resuelve aquí `snapshot.py`, que antes era el
`buildSnapshotData.ts` de Next.js.

La identidad de cada persona (`id`, `name`, `role`) sale de la cuenta de la
intranet: `name` es `first_name` o, si falta, el usuario (como en Nexo) y
`role` es su rol de Gestión Humana (`gh_role_of`), no el primer grupo.
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model

from apps.analytics.configuracion import business_base_for_range
from apps.analytics.scoring import compute_data_quality
from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    get_month_closure_period,
    monthly_business_base,
    monthly_business_base_for_users,
)
from apps.tasks.models import Task, TaskActivity
from apps.tasks.roles import gh_role_of
from apps.tasks.rounding import round_half_up

from .insights import (
    compute_findings,
    compute_recommendations,
    compute_risk_quadrant,
    compute_team_insights,
    compute_team_monthly_snapshots,
    compute_trend_comparisons,
    explain_carga_indicator,
    explain_consultas_indicator,
    explain_cumplimiento_indicator,
    explain_motivo_distribution,
    get_activity_reason_label_map,
    previous_equivalent_period,
    resolve_custom_range_period_status,
    resolve_monthly_period_status,
)
from .member_kpis import (
    _local_month_bounds,
    _month_bounds,
    compute_custom_range_member_kpis,
    compute_effective_member_bases,
    compute_monthly_member_kpis,
    compute_range_member_kpis,
    resolve_closure_cutoff,
)

User = get_user_model()


def nombre_de(user) -> str:
    """El nombre con que el motor muestra a una persona (como en Nexo)."""
    return user.first_name or user.username


def _user_identity(user) -> dict:
    return {"id": user.id, "name": nombre_de(user), "role": gh_role_of(user)}


def _usuarios_en_orden(user_ids: list[int]) -> list:
    """Las cuentas del roster en el orden en que vienen (el del roster, por
    nombre): el orden de `members` es el del documento."""
    por_id = {u.id: u for u in User.objects.filter(id__in=user_ids)}
    return [por_id[i] for i in user_ids if i in por_id]


def compute_team_alerts(members: list[dict]) -> list[dict]:
    """Alertas de un período: cumplimiento < 60% (con tareas) y sobrecarga."""
    alerts: list[dict] = []
    for m in members:
        if m["completed_pct"] < 60 and m["total_tasks"] > 0:
            alerts.append(
                {
                    "user_id": m["id"],
                    "name": m["name"],
                    "type": "cumplimiento",
                    "value": m["completed_pct"],
                }
            )
        if m["carga_label"] == "Sobrecarga":
            alerts.append(
                {
                    "user_id": m["id"],
                    "name": m["name"],
                    "type": "sobrecarga",
                    "value": m["carga_pct"],
                }
            )
    return alerts


def _ranking_row(m: dict) -> dict:
    return {
        "id": m["id"],
        "name": m["name"],
        "role": m["role"],
        "score": m["score"],
        "completed_pct": m["completed_pct"],
    }


def compute_monthly_ranking(members: list[dict]) -> list[dict]:
    """Por score y, a igual score, por cumplimiento (MENSUAL y RANGO
    PERSONALIZADO)."""
    ranked = sorted(members, key=lambda m: (-m["score"], -m["completed_pct"]))
    return [_ranking_row(m) for m in ranked]


def compute_range_ranking(members: list[dict]) -> list[dict]:
    """RANGO DE MESES: prioridad invertida (cumplimiento primero), como en
    Nexo."""
    ranked = sorted(members, key=lambda m: (-m["completed_pct"], -m["score"]))
    return [_ranking_row(m) for m in ranked]


def compute_consultas_by_reason(
    user_ids: list[int], start: datetime, end: datetime, prev_start: datetime, prev_end: datetime
) -> list[dict]:
    """Consultas (actividades de SEGUIMIENTO) por motivo en `[start, end]`,
    con su % y su tendencia contra `[prev_start, prev_end]`. El período
    anterior va completo, sin fecha de corte (como en Nexo)."""
    activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=start,
            created_at__lte=end,
            task__type=Task.Type.SEGUIMIENTO,
        ).only("reason", "duration")
    )
    prev_counts: dict[str, int] = {}
    for reason in TaskActivity.objects.filter(
        author_id__in=user_ids,
        created_at__gte=prev_start,
        created_at__lte=prev_end,
        task__type=Task.Type.SEGUIMIENTO,
    ).values_list("reason", flat=True):
        prev_counts[reason] = prev_counts.get(reason, 0) + 1

    reason_map: dict[str, dict] = {}
    for act in activities:
        entry = reason_map.setdefault(act.reason, {"count": 0, "total_minutes": 0})
        entry["count"] += 1
        entry["total_minutes"] += act.duration

    total = len(activities)
    label_map = get_activity_reason_label_map()
    items = []
    for reason, d in reason_map.items():
        pct = round_half_up(d["count"] / total * 100) if total > 0 else 0
        prev_count = prev_counts.get(reason)
        trend_pct = (
            round_half_up((d["count"] - prev_count) / prev_count * 100) if prev_count else None
        )
        items.append(
            {
                "reason": reason,
                "count": d["count"],
                "total_minutes": d["total_minutes"],
                "pct": pct,
                "trend_pct": trend_pct,
                "interpretation": explain_motivo_distribution(
                    reason, label_map.get(reason, reason), pct, trend_pct
                ),
            }
        )
    items.sort(key=lambda x: -x["count"])
    return items


def _consultas_previas(user_ids, prev_start, prev_end) -> int:
    return TaskActivity.objects.filter(
        author_id__in=user_ids,
        created_at__gte=prev_start,
        created_at__lte=prev_end,
        task__type=Task.Type.SEGUIMIENTO,
    ).count()


def _top_reason(consultas_by_reason: list[dict]) -> dict | None:
    if not consultas_by_reason:
        return None
    primero = consultas_by_reason[0]
    etiqueta = get_activity_reason_label_map().get(primero["reason"], primero["reason"])
    return {"label": etiqueta, "pct": primero["pct"]}


def _team_carga_pct(users, effective_bases, total_carga_real_hours) -> int:
    """La carga del equipo contra la suma de las bases de cada persona."""
    totales = {
        clave: sum(effective_bases[u.id][clave] for u in users)
        for clave in (
            "limit_base_hours",
            "limit_low_hours",
            "limit_high_hours",
            "limit_overload_hours",
        )
    }
    team_range = compute_workload_range(
        total_carga_real_hours,
        totales["limit_base_hours"],
        totales["limit_low_hours"],
        totales["limit_high_hours"],
        totales["limit_overload_hours"],
    )
    return compute_workload_pct(
        total_carga_real_hours, totales["limit_base_hours"], team_range["max"]
    )


def _totales(members: list[dict]) -> dict:
    return {
        "total_consultas": sum(m["seguimiento_total"] for m in members),
        "total_tasks": sum(m["total_tasks"] for m in members),
        "total_completed_tasks": sum(m["completed_tasks"] for m in members),
        "total_overdue": sum(m["overdue_count"] for m in members),
        "total_carga_real_hours": round_half_up(sum(m["carga_real_hours"] for m in members) * 100)
        / 100,
        "total_carga_base_hours": round_half_up(sum(m["carga_base_hours"] for m in members) * 100)
        / 100,
    }


def _indicator_explanations(avg_cumplimiento, member_count, avg_carga_pct, consultas, previas):
    return {
        "cumplimiento": explain_cumplimiento_indicator(avg_cumplimiento, member_count),
        "carga": explain_carga_indicator(avg_carga_pct),
        "consultas": explain_consultas_indicator(consultas, previas),
    }


# ── MENSUAL ─────────────────────────────────────────────────────────────────


def assemble_monthly_team_report(
    *,
    user_ids: list[int],
    year: int,
    month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(dt_timezone.utc)
    users = _usuarios_en_orden(user_ids)

    kpis_by_id = compute_monthly_member_kpis(
        user_ids=user_ids,
        year=year,
        month=month,
        explicit_fecha_corte=explicit_fecha_corte,
        now=now,
    )
    members = [{**_user_identity(u), **kpis_by_id[u.id]} for u in users if u.id in kpis_by_id]
    t = _totales(members)

    base = monthly_business_base(year, month)
    _closure, _natural_end, effective_end = get_month_closure_period(year, month)
    effective_bases = compute_effective_member_bases(
        users,
        date(year, month, 1),
        effective_end,
        base["expected_hours_per_day"],
        base["limit_low_per_day"],
        base["limit_high_per_day"],
        base["limit_overload_per_day"],
        now=now,
    )
    avg_carga_pct = _team_carga_pct(users, effective_bases, t["total_carga_real_hours"])
    avg_cumplimiento = (
        round_half_up(sum(m["completed_pct"] for m in members) / len(members)) if members else 0
    )
    carga_range_per_person = compute_workload_range(
        0,
        base["base_hours"],
        base["limit_low_hours"],
        base["limit_high_hours"],
        base["limit_overload_hours"],
    )

    start, end = _month_bounds(year, month)
    cutoff = resolve_closure_cutoff(year, month, explicit_fecha_corte, end, now)
    data_upper_bound = min(end, cutoff)
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    prev_start, prev_end = _month_bounds(prev_year, prev_month)
    consultas_by_reason = compute_consultas_by_reason(
        user_ids, start, data_upper_bound, prev_start, prev_end
    )
    top_reason = _top_reason(consultas_by_reason)

    trends = compute_trend_comparisons(compute_team_monthly_snapshots(user_ids, year, month, 6))
    return {
        "team_summary": {
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_carga_real_hours": t["total_carga_real_hours"],
            "total_carga_base_hours": t["total_carga_base_hours"],
            "total_completed_tasks": t["total_completed_tasks"],
            "total_consultas": t["total_consultas"],
            "total_tasks": t["total_tasks"],
            "hours_per_day": base["hours_per_day"],
            "carga_range_min": round_half_up(base["base_hours"] * 100) / 100,
            "carga_range_max": carga_range_per_person["max"],
        },
        "members": members,
        "ranking": compute_monthly_ranking(members),
        "distribuciones": {
            "consultas_by_reason": consultas_by_reason,
            "risk_quadrant": compute_risk_quadrant(members),
        },
        "trends": trends,
        "findings": compute_findings(
            avg_cumplimiento=avg_cumplimiento,
            avg_cumplimiento_delta=trends["mes_anterior"]["delta"],
            members=members,
            total_overdue=t["total_overdue"],
            top_reason=top_reason,
        ),
        # Sin Equilibrio Operativo: `snapshot` los recompone en el mes en curso.
        "insights": compute_team_insights(
            members=members, total_carga_real_hours=t["total_carga_real_hours"]
        ),
        "indicator_explanations": _indicator_explanations(
            avg_cumplimiento,
            len(members),
            avg_carga_pct,
            t["total_consultas"],
            _consultas_previas(user_ids, prev_start, prev_end),
        ),
        "recommendations": compute_recommendations(
            avg_cumplimiento=avg_cumplimiento, members=members, top_reason=top_reason
        ),
        "alerts": compute_team_alerts(members),
        "data_quality": compute_data_quality(user_ids=user_ids),
        "period_status": resolve_monthly_period_status(month, year, now),
    }


# ── RANGO PERSONALIZADO ─────────────────────────────────────────────────────


def assemble_custom_range_team_report(
    *,
    user_ids: list[int],
    period_start: datetime,
    period_end: datetime,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """Como el MENSUAL, salvo el corte (sin cierre de mes) y la tendencia de
    los motivos, que compara con un período anterior de igual duración."""
    now = now or datetime.now(dt_timezone.utc)
    users = _usuarios_en_orden(user_ids)

    kpis_by_id = compute_custom_range_member_kpis(
        user_ids=user_ids,
        period_start=period_start,
        period_end=period_end,
        explicit_fecha_corte=explicit_fecha_corte,
        now=now,
    )
    members = [{**_user_identity(u), **kpis_by_id[u.id]} for u in users if u.id in kpis_by_id]
    t = _totales(members)

    base = business_base_for_range(period_start.date(), period_end.date())
    effective_bases = compute_effective_member_bases(
        users,
        period_start.date(),
        period_end.date(),
        base["expected_hours_per_day"],
        base["limit_low_per_day"],
        base["limit_high_per_day"],
        base["limit_overload_per_day"],
        now=now,
    )
    avg_carga_pct = _team_carga_pct(users, effective_bases, t["total_carga_real_hours"])
    avg_cumplimiento = (
        round_half_up(sum(m["completed_pct"] for m in members) / len(members)) if members else 0
    )
    carga_range_per_person = compute_workload_range(
        0,
        base["base_hours"],
        base["limit_low_hours"],
        base["limit_high_hours"],
        base["limit_overload_hours"],
    )

    cutoff = min(explicit_fecha_corte, now) if explicit_fecha_corte else min(period_end, now)
    data_upper_bound = min(period_end, cutoff)
    prev = previous_equivalent_period(period_start, period_end)
    consultas_by_reason = compute_consultas_by_reason(
        user_ids, period_start, data_upper_bound, prev["start"], prev["end"]
    )
    top_reason = _top_reason(consultas_by_reason)

    return {
        "team_summary": {
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_carga_real_hours": t["total_carga_real_hours"],
            "total_carga_base_hours": t["total_carga_base_hours"],
            "total_completed_tasks": t["total_completed_tasks"],
            "total_consultas": t["total_consultas"],
            "total_tasks": t["total_tasks"],
            "hours_per_day": base["hours_per_day"],
            "carga_range_min": round_half_up(base["base_hours"] * 100) / 100,
            "carga_range_max": carga_range_per_person["max"],
        },
        "members": members,
        "ranking": compute_monthly_ranking(members),
        "distribuciones": {
            "consultas_by_reason": consultas_by_reason,
            "risk_quadrant": compute_risk_quadrant(members),
        },
        "findings": compute_findings(
            avg_cumplimiento=avg_cumplimiento,
            avg_cumplimiento_delta=None,
            members=members,
            total_overdue=t["total_overdue"],
            top_reason=top_reason,
        ),
        "insights": compute_team_insights(
            members=members, total_carga_real_hours=t["total_carga_real_hours"]
        ),
        "indicator_explanations": _indicator_explanations(
            avg_cumplimiento,
            len(members),
            avg_carga_pct,
            t["total_consultas"],
            _consultas_previas(user_ids, prev["start"], prev["end"]),
        ),
        "recommendations": compute_recommendations(
            avg_cumplimiento=avg_cumplimiento, members=members, top_reason=top_reason
        ),
        "alerts": compute_team_alerts(members),
        "data_quality": compute_data_quality(user_ids=user_ids),
        "period_status": resolve_custom_range_period_status(period_end, now),
    }


# ── RANGO DE MESES ──────────────────────────────────────────────────────────


def compute_range_alerts(month_snapshots: list[dict], users: list) -> list[dict]:
    """Una persona entra en alerta si el problema se repite en al menos la
    mitad de sus meses con tareas; `value` es el promedio en los meses
    afectados y `months_affected`, cuántos fueron."""
    alerts: list[dict] = []
    for user in users:
        activos = [
            ms for ms in month_snapshots if ms["member_snapshots"][user.id]["total_tasks"] > 0
        ]
        if not activos:
            continue
        umbral = -(-len(activos) // 2)  # techo de la mitad, sin flotantes
        identidad = _user_identity(user)

        bajos = [ms for ms in activos if ms["member_snapshots"][user.id]["completed_pct"] < 60]
        if len(bajos) >= umbral:
            alerts.append(
                {
                    "user_id": identidad["id"],
                    "name": identidad["name"],
                    "type": "cumplimiento",
                    "value": round_half_up(
                        sum(ms["member_snapshots"][user.id]["completed_pct"] for ms in bajos)
                        / len(bajos)
                    ),
                    "months_affected": len(bajos),
                }
            )
        sobrecargados = [
            ms for ms in activos if ms["member_snapshots"][user.id]["carga_label"] == "Sobrecarga"
        ]
        if len(sobrecargados) >= umbral:
            alerts.append(
                {
                    "user_id": identidad["id"],
                    "name": identidad["name"],
                    "type": "sobrecarga",
                    "value": round_half_up(
                        sum(ms["member_snapshots"][user.id]["carga_pct"] for ms in sobrecargados)
                        / len(sobrecargados)
                    ),
                    "months_affected": len(sobrecargados),
                }
            )
    return alerts


def assemble_range_team_report(
    *,
    user_ids: list[int],
    from_year: int,
    from_month: int,
    to_year: int,
    to_month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """El más distinto de los tres: ranking y alertas propios, y además la
    evolución mes a mes, la tendencia del rango y los meses problemáticos."""
    now = now or datetime.now(dt_timezone.utc)
    users = _usuarios_en_orden(user_ids)

    kpis = compute_range_member_kpis(
        user_ids=user_ids,
        from_year=from_year,
        from_month=from_month,
        to_year=to_year,
        to_month=to_month,
        explicit_fecha_corte=explicit_fecha_corte,
        now=now,
    )
    month_snapshots = kpis["month_snapshots"]
    aggregated = kpis["aggregated_members"]
    members = [{**_user_identity(u), **aggregated[u.id]} for u in users if u.id in aggregated]
    t = _totales(members)

    active_months = [ms for ms in month_snapshots if ms["total_tasks"] > 0]
    avg_cumplimiento = (
        round_half_up(sum(ms["team_avg_cumplimiento"] for ms in active_months) / len(active_months))
        if active_months
        else 0
    )

    range_start, _ = _local_month_bounds(from_year, from_month)
    _, range_end = _local_month_bounds(to_year, to_month)
    range_start_rate = monthly_business_base(from_year, from_month)
    effective_bases = compute_effective_member_bases(
        users,
        range_start.date(),
        range_end.date(),
        range_start_rate["expected_hours_per_day"],
        range_start_rate["limit_low_per_day"],
        range_start_rate["limit_high_per_day"],
        range_start_rate["limit_overload_per_day"],
        now=now,
        period_start_instant=range_start,
        period_end_instant=range_end,
    )
    avg_carga_pct = _team_carga_pct(users, effective_bases, t["total_carga_real_hours"])

    last_month_biz = monthly_business_base_for_users(users, to_year, to_month)["shared"]
    carga_range_last_month = compute_workload_range(
        0,
        last_month_biz["limit_base_hours"],
        last_month_biz["limit_low_hours"],
        last_month_biz["limit_high_hours"],
        last_month_biz["limit_overload_hours"],
    )

    cutoff = resolve_closure_cutoff(to_year, to_month, explicit_fecha_corte, range_end, now)
    data_upper_bound = min(range_end, cutoff)
    prev = previous_equivalent_period(range_start, range_end)
    consultas_by_reason = compute_consultas_by_reason(
        user_ids, range_start, data_upper_bound, prev["start"], prev["end"]
    )
    top_reason = _top_reason(consultas_by_reason)

    problematic_months = [
        {
            "month": ms["month"],
            "label": ms["label"],
            "team_avg_cumplimiento": ms["team_avg_cumplimiento"],
        }
        for ms in month_snapshots
        if ms["total_tasks"] > 0 and ms["team_avg_cumplimiento"] < 60
    ]
    first_active = next((ms for ms in month_snapshots if ms["total_tasks"] > 0), None)
    last_active = next((ms for ms in reversed(month_snapshots) if ms["total_tasks"] > 0), None)
    first_avg = first_active["team_avg_cumplimiento"] if first_active else 0
    last_avg = last_active["team_avg_cumplimiento"] if last_active else 0
    change = last_avg - first_avg
    trend = "mejora" if change > 5 else "deterioro" if change < -5 else "estancamiento"

    return {
        "team_summary": {
            "avg_cumplimiento": avg_cumplimiento,
            "avg_carga_pct": avg_carga_pct,
            "total_completed_tasks": t["total_completed_tasks"],
            "total_tasks": t["total_tasks"],
            "total_carga_real_hours": t["total_carga_real_hours"],
            "total_carga_base_hours": t["total_carga_base_hours"],
            "total_consultas": t["total_consultas"],
            "hours_per_day": last_month_biz["hours_per_day"],
            "carga_range_min": round_half_up(last_month_biz["limit_base_hours"] * 100) / 100,
            "carga_range_max": carga_range_last_month["max"],
        },
        "members": members,
        "ranking": compute_range_ranking(members),
        "distribuciones": {
            "consultas_by_reason": consultas_by_reason,
            "risk_quadrant": compute_risk_quadrant(members),
        },
        "monthly_evolution": month_snapshots,
        "range_trend": {
            "cumplimiento_trend": trend,
            "cumplimiento_change": change,
            "first_month_avg_cumplimiento": first_avg,
            "last_month_avg_cumplimiento": last_avg,
        },
        "problematic_months": problematic_months,
        # `total_overdue` en 0: el agregado de un rango no rastrea vencidas por
        # persona (limitación de Nexo que se conserva).
        "findings": compute_findings(
            avg_cumplimiento=avg_cumplimiento,
            avg_cumplimiento_delta=change,
            members=members,
            total_overdue=0,
            top_reason=top_reason,
        ),
        "insights": compute_team_insights(
            members=members, total_carga_real_hours=t["total_carga_real_hours"]
        ),
        "indicator_explanations": _indicator_explanations(
            avg_cumplimiento,
            len(members),
            avg_carga_pct,
            t["total_consultas"],
            _consultas_previas(user_ids, prev["start"], prev["end"]),
        ),
        "recommendations": compute_recommendations(
            avg_cumplimiento=avg_cumplimiento, members=members, top_reason=top_reason
        ),
        "alerts": compute_range_alerts(month_snapshots, users),
        "data_quality": compute_data_quality(user_ids=user_ids),
        "period_status": resolve_monthly_period_status(to_month, to_year, now),
    }
