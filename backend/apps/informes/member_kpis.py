"""Los indicadores por colaborador de un informe ejecutivo (`ReportMemberKpi`
de Nexo): la tabla y el ranking del «Detalle por colaborador».

Portado de `apps.reports.member_kpis` de Nexo, que a su vez replicaba los tres
constructores de `buildSnapshotData.ts`: MENSUAL, RANGO PERSONALIZADO y RANGO
DE MESES. Las fórmulas son las mismas; las primitivas (`compute_simple_score`,
el semáforo de carga, la base horaria con cierre, los estados especiales, el
inicio efectivo del historial…) son las que ya portó el motor de KPI
(`apps.analytics`), no copias.

`ReportMemberKpi` no usa el Performance Score ni el Equilibrio Operativo del
motor general: tiene su propio score (`compute_simple_score`) y su propia
reconstrucción de la «fecha de corte» (`as_of_fecha_corte`).

Fechas: el mes calendario se toma en UTC (`_month_bounds`), como Nexo, salvo
en RANGO DE MESES, donde Nexo usaba la hora local del servidor (America/
Guayaquil, UTC-5) y por eso aquí va `_local_month_bounds`. Es una diferencia
real de Nexo que se conserva para dar los mismos números (hallazgo de su Fase
71), no un descuido.
"""

from copy import copy
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model

from apps.analytics.configuracion import (
    business_base_for_range,
    get_holiday_set,
    get_team_special_status_day_map,
)
from apps.analytics.health_score import classify_estado_operativo
from apps.analytics.history import compute_effective_history_start
from apps.analytics.scoring import (
    compute_completed_pct_any,
    compute_estimated_vs_real_ratio,
    compute_simple_score,
)
from apps.analytics.utils import is_task_overdue
from apps.analytics.workload import (
    compute_workload_pct,
    compute_workload_range,
    get_month_closure_period,
    monthly_business_base,
    monthly_business_base_for_users,
    sum_weighted_base_hours,
    sum_weighted_limit,
)
from apps.tasks.business_time import BUSINESS_TZ_OFFSET_HOURS, business_day_real_range
from apps.tasks.models import Task, TaskActivity
from apps.tasks.rounding import round_half_up

User = get_user_model()

_MONTH_NAMES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """Del primer instante al último del mes, en UTC."""
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)
    return start, end


def _local_month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """Los límites del mes en hora LOCAL del negocio (UTC-5), como
    `monthBounds()` de Nexo (`new Date(year, month - 1, 1)` en un servidor en
    America/Guayaquil). Solo para el RANGO DE MESES: es el único constructor
    de Nexo que pasaba esos límites directamente a las consultas."""
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    offset = timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)
    start = datetime(year, month, 1, tzinfo=dt_timezone.utc) + offset
    end = (
        datetime(next_year, next_month, 1, tzinfo=dt_timezone.utc)
        + offset
        - timedelta(microseconds=1)
    )
    return start, end


def _ts_local_period_end_date(clamped_start_dt: datetime, period_end_instant: datetime) -> date:
    """El último día que alcanza el bucle de pasos de 24 h de
    `sumWeightedBaseHours` de Nexo cuando empieza a una hora del día distinta
    de la del fin del período: puede ser un día después de
    `period_end_instant.date()`. Se replica a propósito (es lo que daba Nexo
    con el RANGO DE MESES)."""
    if clamped_start_dt > period_end_instant:
        return clamped_start_dt.date()
    delta_days = (period_end_instant - clamped_start_dt) // timedelta(days=1)
    return (clamped_start_dt + timedelta(days=delta_days)).date()


def month_label(year: int, month: int) -> str:
    """«marzo de 2026» (`Intl.DateTimeFormat('es-CL', {month: 'long', year:
    'numeric'})` de Nexo)."""
    return f"{_MONTH_NAMES[month - 1]} de {year}"


def resolve_closure_cutoff(
    year: int, month: int, explicit_fecha_corte: datetime | None, fallback: datetime, now: datetime
) -> datetime:
    """La fecha de corte efectiva (Motor de Cierre Inteligente). Una fecha de
    corte explícita gana siempre; si el mes tiene cierre, vale su
    `cutoff_date` (el mismo corte sin importar cuándo se genere el informe);
    si no, `fallback`. Nunca después de `now`."""
    if explicit_fecha_corte:
        return min(explicit_fecha_corte, now)
    closure, _natural_end, _effective_end = get_month_closure_period(year, month)
    if closure:
        _start, cutoff_instant = business_day_real_range(closure.cutoff_date.date())
        return min(cutoff_instant, now)
    return min(fallback, now)


def as_of_fecha_corte(tasks: list, cutoff: datetime) -> list:
    """El estado de cada tarea «como era» en la fecha de corte. No hay
    historial de estados por tarea: una COMPLETADA cuyo `completed_at` es
    posterior al corte se trata como pendiente (lo más conservador). Trabaja
    sobre copias en memoria: nunca toca ni guarda la tarea real."""
    result = []
    for t in tasks:
        if t.status == Task.Status.COMPLETADA and t.completed_at and t.completed_at > cutoff:
            copia = copy(t)
            copia.status = Task.Status.PENDIENTE
            result.append(copia)
        else:
            result.append(t)
    return result


def compute_effective_member_bases(
    users: list,
    period_start: date,
    period_end: date,
    # Tasa diaria ESPERADA del período (las horas del mes / sus días hábiles),
    # no las horas efectivas por día: el objetivo mensual es lo que se prorratea.
    expected_hours_per_day: float,
    limit_low_per_day: float,
    limit_high_per_day: float,
    limit_overload_per_day: float,
    *,
    now: datetime,
    period_start_instant: datetime | None = None,
    period_end_instant: datetime | None = None,
) -> dict[int, dict]:
    """La base horaria y los límites de cada persona, recortados al tramo en
    que de verdad estuvo (quien entra a mitad de período no se mide contra el
    período entero). Los permisos individuales no entran en este prorrateo
    (como en Nexo, `leave_map` vacío).

    `period_start_instant`/`period_end_instant` solo los pasa el RANGO DE
    MESES, con los límites en hora local (ver `_local_month_bounds`)."""
    result: dict[int, dict] = {}
    if not users:
        return result

    special_map = get_team_special_status_day_map(users, period_start, period_end)
    holidays = get_holiday_set()
    period_start_dt = period_start_instant or datetime(
        period_start.year, period_start.month, period_start.day, tzinfo=dt_timezone.utc
    )

    for user in users:
        effective_start = compute_effective_history_start(user=user, now=now)
        clamped_start_dt = max(effective_start, period_start_dt)
        was_prorated = clamped_start_dt > period_start_dt
        clamped_start = clamped_start_dt.date()
        user_special_map = special_map.get(user.id, {})

        # El rango vacío se decide comparando INSTANTES, no la fecha ya
        # ajustada (que coincidiría trivialmente con la de inicio).
        if period_end_instant is not None:
            is_empty_range = clamped_start_dt > period_end_instant
            user_period_end = _ts_local_period_end_date(clamped_start_dt, period_end_instant)
        else:
            is_empty_range = clamped_start > period_end
            user_period_end = period_end

        if is_empty_range:
            result[user.id] = {
                "base_hours": 0.0,
                "limit_base_hours": 0.0,
                "limit_low_hours": 0.0,
                "limit_high_hours": 0.0,
                "limit_overload_hours": 0.0,
                "effective_start": effective_start,
                "was_prorated": True,
            }
            continue

        result[user.id] = {
            "base_hours": sum_weighted_base_hours(
                clamped_start,
                user_period_end,
                expected_hours_per_day,
                holidays,
                {},
                user_special_map,
                "daily_hours",
            ),
            "limit_base_hours": sum_weighted_base_hours(
                clamped_start,
                user_period_end,
                expected_hours_per_day,
                holidays,
                {},
                user_special_map,
                "limit_base",
            ),
            "limit_low_hours": sum_weighted_limit(
                clamped_start,
                user_period_end,
                holidays,
                user_special_map,
                limit_low_per_day,
                "limit_low",
            ),
            "limit_high_hours": sum_weighted_limit(
                clamped_start,
                user_period_end,
                holidays,
                user_special_map,
                limit_high_per_day,
                "limit_high",
            ),
            "limit_overload_hours": sum_weighted_limit(
                clamped_start,
                user_period_end,
                holidays,
                user_special_map,
                limit_overload_per_day,
                "limit_overload",
            ),
            "effective_start": effective_start,
            "was_prorated": was_prorated,
        }
    return result


def _by_reason(activities) -> list[dict]:
    """Consultas agrupadas por motivo, en el orden en que aparece cada uno."""
    by_reason: dict[str, dict] = {}
    for act in activities:
        entry = by_reason.setdefault(act.reason, {"count": 0, "total_minutes": 0})
        entry["count"] += 1
        entry["total_minutes"] += act.duration
    return [
        {"reason": r, "count": d["count"], "total_minutes": d["total_minutes"]}
        for r, d in by_reason.items()
    ]


def _carga(user_id, fija_tasks, activities, base: dict) -> tuple[float, dict, int]:
    """Horas reales (tareas FIJA completadas + actividades), su semáforo y su
    porcentaje, contra la base de la persona."""
    fija_hours = sum(t.real_hours for t in fija_tasks if t.assigned_to_id == user_id)
    activity_hours = sum(a.duration for a in activities if a.author_id == user_id) / 60
    carga_real_hours = round_half_up((fija_hours + activity_hours) * 100) / 100
    carga_range = compute_workload_range(
        carga_real_hours,
        base["limit_base_hours"],
        base["limit_low_hours"],
        base["limit_high_hours"],
        base["limit_overload_hours"],
    )
    carga_pct = compute_workload_pct(carga_real_hours, base["limit_base_hours"], carga_range["max"])
    return carga_real_hours, carga_range, carga_pct


def _score(tasks) -> int:
    in_progress = [t for t in tasks if t.status == Task.Status.EN_PROGRESO]
    avg_progress = (
        round_half_up(sum(t.progress for t in in_progress) / len(in_progress)) if in_progress else 0
    )
    total_estimated = sum(t.estimated_hours for t in tasks)
    total_real = sum(t.real_hours for t in tasks)
    carga_ratio = compute_estimated_vs_real_ratio(total_real, total_estimated)
    return compute_simple_score(compute_completed_pct_any(tasks), carga_ratio, avg_progress)


def _member_row(user, tasks, ref_date, carga, base, activities) -> dict:
    carga_real_hours, carga_range, carga_pct = carga
    return {
        "score": _score(tasks),
        "completed_pct": compute_completed_pct_any(tasks),
        "carga_pct": carga_pct,
        "carga_real_hours": carga_real_hours,
        "carga_base_hours": base["base_hours"],
        "carga_color": carga_range["color"],
        "carga_label": carga_range["label"],
        "carga_range_min": round_half_up(base["limit_base_hours"] * 100) / 100,
        "carga_range_max": carga_range["max"],
        "total_tasks": len(tasks),
        "completed_tasks": sum(1 for t in tasks if t.status == Task.Status.COMPLETADA),
        "overdue_count": sum(1 for t in tasks if is_task_overdue(t.end_date, t.status, ref_date)),
        "seguimiento_total": len(activities),
        "by_reason": _by_reason(activities),
        "base_was_prorated": base["was_prorated"],
        "base_effective_start": (
            base["effective_start"].isoformat() if base["was_prorated"] else None
        ),
    }


_TASK_FIELDS = (
    "assigned_to_id",
    "status",
    "end_date",
    "progress",
    "estimated_hours",
    "real_hours",
    "completed_at",
)


def compute_monthly_member_kpis(
    *,
    user_ids: list[int],
    year: int,
    month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict[int, dict]:
    """Constructor MENSUAL: `{user_id: ReportMemberKpi}` sin identidad (la
    pone `team_report`). Sin `estado_operativo`/`principal_hallazgo`: en el
    mes en curso dependen del Equilibrio Operativo, que calcula `snapshot`."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))
    if not users:
        return {}

    start, end = _month_bounds(year, month)
    cutoff = resolve_closure_cutoff(year, month, explicit_fecha_corte, end, now)
    data_upper_bound = min(end, cutoff)

    base = monthly_business_base(year, month)
    _closure, _natural_end, effective_end = get_month_closure_period(year, month)
    carga_start = date(year, month, 1)
    carga_real_start, _ = business_day_real_range(carga_start)
    _, carga_real_end_raw = business_day_real_range(effective_end)
    carga_real_end = min(carga_real_end_raw, cutoff)

    effective_bases = compute_effective_member_bases(
        users,
        carga_start,
        effective_end,
        base["expected_hours_per_day"],
        base["limit_low_per_day"],
        base["limit_high_per_day"],
        base["limit_overload_per_day"],
        now=now,
    )

    all_tasks = as_of_fecha_corte(
        list(
            Task.objects.filter(
                assigned_to_id__in=user_ids, end_date__gte=start, end_date__lte=end
            ).only(*_TASK_FIELDS)
        ),
        cutoff,
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=start,
            created_at__lte=data_upper_bound,
            task__type=Task.Type.SEGUIMIENTO,
        ).only("author_id", "reason", "duration")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids,
            type=Task.Type.FIJA,
            completed_at__gte=carga_real_start,
            completed_at__lte=carga_real_end,
        ).only("assigned_to_id", "real_hours")
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=carga_real_start,
            created_at__lte=carga_real_end,
        ).only("author_id", "duration")
    )

    result: dict[int, dict] = {}
    for user in users:
        user_base = effective_bases[user.id]
        result[user.id] = _member_row(
            user,
            [t for t in all_tasks if t.assigned_to_id == user.id],
            data_upper_bound,
            _carga(user.id, fija_tasks_for_carga, activities_for_carga, user_base),
            user_base,
            [a for a in all_activities if a.author_id == user.id],
        )
    return result


# ── Estado operativo y hallazgo principal (de `reportInsights.ts`) ──────────

_CARGA_LABEL_SCORE: dict[str, int] = {
    "Óptimo": 100,
    "Moderado": 80,
    "Carga elevada": 60,
    "Subutilización": 30,
    "Sobrecarga": 30,
}


def derive_estado_operativo(
    *, completed_pct: float, carga_label: str, overdue_count: int, equilibrio_score=None
) -> dict:
    """El Estado Operativo (5 niveles) de la persona. Con su Equilibrio
    Operativo real (mes en curso) lo clasifica tal cual; sin él, lo aproxima
    con el cumplimiento, la carga y las vencidas (`deriveEstadoOperativo`)."""
    if equilibrio_score is not None:
        return classify_estado_operativo(equilibrio_score)
    vencidas_penalty = min(30, overdue_count * 10)
    approx_score = max(
        0,
        round_half_up(
            completed_pct * 0.5 + _CARGA_LABEL_SCORE[carga_label] * 0.5 - vencidas_penalty
        ),
    )
    return classify_estado_operativo(approx_score)


_PRINCIPAL_HALLAZGO_LABEL: dict[str, str] = {
    "sin_datos": "Sin actividad registrada",
    "sobrecarga": "Sobrecarga",
    "subutilizacion": "Subutilización",
    "capacidad_limitada": "Capacidad limitada",
    "retrasos_recurrentes": "Retrasos recurrentes",
    "consistencia_baja": "Consistencia baja",
    "sin_tareas_vencidas": "Sin tareas vencidas",
    "carga_equilibrada": "Carga equilibrada",
}


def compute_principal_hallazgo(
    *,
    carga_label: str,
    completed_pct: float,
    overdue_count: int,
    total_tasks: int,
    consistency_variable: bool | None = None,
    capacidad_limitada: bool | None = None,
) -> str:
    """El hallazgo predominante de la persona: reglas fijas, de mayor a menor
    severidad (`computePrincipalHallazgo`)."""
    if total_tasks == 0:
        return _PRINCIPAL_HALLAZGO_LABEL["sin_datos"]
    if carga_label == "Sobrecarga":
        return _PRINCIPAL_HALLAZGO_LABEL["sobrecarga"]
    if carga_label == "Subutilización":
        return _PRINCIPAL_HALLAZGO_LABEL["subutilizacion"]
    if capacidad_limitada:
        return _PRINCIPAL_HALLAZGO_LABEL["capacidad_limitada"]
    if overdue_count > 0:
        return _PRINCIPAL_HALLAZGO_LABEL["retrasos_recurrentes"]
    if consistency_variable:
        return _PRINCIPAL_HALLAZGO_LABEL["consistencia_baja"]
    if completed_pct >= 80:
        return _PRINCIPAL_HALLAZGO_LABEL["sin_tareas_vencidas"]
    return _PRINCIPAL_HALLAZGO_LABEL["carga_equilibrada"]


# ── RANGO PERSONALIZADO ─────────────────────────────────────────────────────


def compute_custom_range_member_kpis(
    *,
    user_ids: list[int],
    period_start: datetime,
    period_end: datetime,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict[int, dict]:
    """Constructor RANGO PERSONALIZADO (un rango de días cualquiera). Sin
    cierre de mes: el corte es la fecha explícita o el fin del rango, nunca
    después de ahora. Trae ya `estado_operativo`/`principal_hallazgo`
    (aproximados: no hay Equilibrio Operativo de un rango)."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))
    if not users:
        return {}

    cutoff = min(explicit_fecha_corte, now) if explicit_fecha_corte else min(period_end, now)
    data_upper_bound = min(period_end, cutoff)

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
    carga_real_start, _ = business_day_real_range(period_start.date())
    _, carga_real_end_raw = business_day_real_range(period_end.date())
    carga_real_end = min(carga_real_end_raw, cutoff)

    all_tasks = as_of_fecha_corte(
        list(
            Task.objects.filter(
                assigned_to_id__in=user_ids, end_date__gte=period_start, end_date__lte=period_end
            ).only(*_TASK_FIELDS)
        ),
        cutoff,
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=period_start,
            created_at__lte=data_upper_bound,
            task__type=Task.Type.SEGUIMIENTO,
        ).only("author_id", "reason", "duration")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids,
            type=Task.Type.FIJA,
            completed_at__gte=carga_real_start,
            completed_at__lte=carga_real_end,
        ).only("assigned_to_id", "real_hours")
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=carga_real_start,
            created_at__lte=carga_real_end,
        ).only("author_id", "duration")
    )

    result: dict[int, dict] = {}
    for user in users:
        user_base = effective_bases[user.id]
        row = _member_row(
            user,
            [t for t in all_tasks if t.assigned_to_id == user.id],
            data_upper_bound,
            _carga(user.id, fija_tasks_for_carga, activities_for_carga, user_base),
            user_base,
            [a for a in all_activities if a.author_id == user.id],
        )
        row["estado_operativo"] = derive_estado_operativo(
            completed_pct=row["completed_pct"],
            carga_label=row["carga_label"],
            overdue_count=row["overdue_count"],
        )
        row["principal_hallazgo"] = compute_principal_hallazgo(
            carga_label=row["carga_label"],
            completed_pct=row["completed_pct"],
            overdue_count=row["overdue_count"],
            total_tasks=row["total_tasks"],
        )
        result[user.id] = row
    return result


# ── RANGO DE MESES ──────────────────────────────────────────────────────────


def months_in_range(
    from_year: int, from_month: int, to_year: int, to_month: int
) -> list[tuple[int, int]]:
    """`(año, mes)` de cada mes del rango, ambos extremos incluidos."""
    months: list[tuple[int, int]] = []
    y, m = from_year, from_month
    while y < to_year or (y == to_year and m <= to_month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


def compute_range_member_kpis(
    *,
    user_ids: list[int],
    from_year: int,
    from_month: int,
    to_year: int,
    to_month: int,
    explicit_fecha_corte: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """Constructor RANGO DE MESES: la evolución mes a mes
    (`month_snapshots`, con `member_snapshots` por id) y el agregado del rango
    por persona (`aggregated_members`). El corte por defecto hereda el cierre
    del ÚLTIMO mes del rango."""
    now = now or datetime.now(dt_timezone.utc)
    users = list(User.objects.filter(id__in=user_ids))
    if not users:
        return {"month_snapshots": [], "aggregated_members": {}}

    months = months_in_range(from_year, from_month, to_year, to_month)
    range_start, _ = _local_month_bounds(from_year, from_month)
    _, range_end = _local_month_bounds(to_year, to_month)

    cutoff = resolve_closure_cutoff(to_year, to_month, explicit_fecha_corte, range_end, now)
    data_upper_bound = min(range_end, cutoff)

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
    range_real_end = min(month_business_info[-1]["real_end"], cutoff)

    all_tasks = as_of_fecha_corte(
        list(
            Task.objects.filter(
                assigned_to_id__in=user_ids, end_date__gte=range_start, end_date__lte=range_end
            ).only(*_TASK_FIELDS)
        ),
        cutoff,
    )
    all_activities = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=range_start,
            created_at__lte=data_upper_bound,
            task__type=Task.Type.SEGUIMIENTO,
        ).only("author_id", "reason", "duration", "created_at")
    )
    fija_tasks_for_carga = list(
        Task.objects.filter(
            assigned_to_id__in=user_ids,
            type=Task.Type.FIJA,
            completed_at__gte=range_real_start,
            completed_at__lte=range_real_end,
        ).only("assigned_to_id", "real_hours", "completed_at")
    )
    activities_for_carga = list(
        TaskActivity.objects.filter(
            author_id__in=user_ids,
            created_at__gte=range_real_start,
            created_at__lte=range_real_end,
        ).only("author_id", "duration", "created_at")
    )

    month_snapshots: list[dict] = []
    for biz_info in month_business_info:
        year, month = biz_info["year"], biz_info["month"]
        start, end = _local_month_bounds(year, month)
        ref_date = min(end, cutoff)
        real_start, real_end = biz_info["real_start"], biz_info["real_end"]

        month_tasks = [t for t in all_tasks if start <= t.end_date <= end]
        month_acts = [a for a in all_activities if start <= a.created_at <= end]
        month_fija = [t for t in fija_tasks_for_carga if real_start <= t.completed_at <= real_end]
        month_carga_acts = [
            a for a in activities_for_carga if real_start <= a.created_at <= real_end
        ]

        member_snapshots: dict[int, dict] = {}
        for user in users:
            tasks = [t for t in month_tasks if t.assigned_to_id == user.id]
            user_biz = biz_info["per_user"].get(user.id, biz_info["shared"])
            carga_real_hours, carga_range, carga_pct = _carga(
                user.id, month_fija, month_carga_acts, user_biz
            )
            member_snapshots[user.id] = {
                "completed_pct": compute_completed_pct_any(tasks),
                "carga_pct": carga_pct,
                "carga_real_hours": carga_real_hours,
                "carga_base_hours": user_biz["base_hours"],
                "carga_color": carga_range["color"],
                "carga_label": carga_range["label"],
                "score": _score(tasks),
                "total_tasks": len(tasks),
                "overdue_count": sum(
                    1 for t in tasks if is_task_overdue(t.end_date, t.status, ref_date)
                ),
            }

        activos = [m for m in member_snapshots.values() if m["total_tasks"] > 0]
        team_avg_cumplimiento = (
            round_half_up(sum(m["completed_pct"] for m in activos) / len(activos)) if activos else 0
        )
        month_snapshots.append(
            {
                "month": f"{year:04d}-{month:02d}",
                "label": month_label(year, month),
                "team_avg_cumplimiento": team_avg_cumplimiento,
                "total_completed_tasks": sum(
                    1 for t in month_tasks if t.status == Task.Status.COMPLETADA
                ),
                "total_tasks": len(month_tasks),
                "total_carga_real_hours": round_half_up(
                    sum(m["carga_real_hours"] for m in member_snapshots.values()) * 100
                )
                / 100,
                "total_carga_base_hours": round_half_up(
                    sum(m["carga_base_hours"] for m in member_snapshots.values()) * 100
                )
                / 100,
                "total_consultas": len(month_acts),
                "member_snapshots": member_snapshots,
            }
        )

    aggregated_members: dict[int, dict] = {}
    for user in users:
        user_tasks = [t for t in all_tasks if t.assigned_to_id == user.id]
        user_activities = [a for a in all_activities if a.author_id == user.id]
        user_range_biz = effective_bases[user.id]
        carga_real_hours, carga_range, carga_pct = _carga(
            user.id, fija_tasks_for_carga, activities_for_carga, user_range_biz
        )

        active_snaps = [
            ms for ms in month_snapshots if ms["member_snapshots"][user.id]["total_tasks"] > 0
        ]
        avg_cumplimiento = (
            round_half_up(
                sum(ms["member_snapshots"][user.id]["completed_pct"] for ms in active_snaps)
                / len(active_snaps)
            )
            if active_snaps
            else 0
        )
        avg_score = (
            round_half_up(
                sum(ms["member_snapshots"][user.id]["score"] for ms in active_snaps)
                / len(active_snaps)
            )
            if active_snaps
            else 0
        )

        # `overdue_count` en 0: Nexo no rastrea las vencidas por persona en el
        # agregado de un rango (limitación suya que se conserva).
        aggregated_members[user.id] = {
            "score": avg_score,
            "completed_pct": avg_cumplimiento,
            "carga_pct": carga_pct,
            "carga_real_hours": carga_real_hours,
            "carga_base_hours": user_range_biz["base_hours"],
            "carga_color": carga_range["color"],
            "carga_label": carga_range["label"],
            "carga_range_min": round_half_up(user_range_biz["limit_base_hours"] * 100) / 100,
            "carga_range_max": carga_range["max"],
            "total_tasks": len(user_tasks),
            "completed_tasks": sum(1 for t in user_tasks if t.status == Task.Status.COMPLETADA),
            "overdue_count": 0,
            "seguimiento_total": len(user_activities),
            "by_reason": _by_reason(user_activities),
            "base_was_prorated": user_range_biz["was_prorated"],
            "base_effective_start": (
                user_range_biz["effective_start"].isoformat()
                if user_range_biz["was_prorated"]
                else None
            ),
            "estado_operativo": derive_estado_operativo(
                completed_pct=avg_cumplimiento, carga_label=carga_range["label"], overdue_count=0
            ),
            "principal_hallazgo": compute_principal_hallazgo(
                carga_label=carga_range["label"],
                completed_pct=avg_cumplimiento,
                overdue_count=0,
                total_tasks=len(user_tasks),
            ),
        }

    return {"month_snapshots": month_snapshots, "aggregated_members": aggregated_members}
