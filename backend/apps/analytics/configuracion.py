"""Ajustes y calendario del motor de KPI, por empresa.

Sustituye lo que el motor usaba de `apps.configuration.services` de Nexo, con
los mismos nombres de función y las mismas claves, para que el resto del
motor se porte sin tocar sus fórmulas:

- Los ajustes con vigencia viven en `novedades.SettingHistory` (una sola tabla
  para todo Gestión Humana, por empresa). Mismo comportamiento que
  `SystemConfigHistory`: el valor que rige un cálculo es el vigente en un
  instante, nunca uno posterior.
- Las horas efectivas del día y las horas esperadas del mes son las mismas
  claves que ya usa Tareas (`apps.tasks.configuracion`): no se duplican.
- Los feriados son los del calendario institucional de la empresa activa
  (`apps.nomina.dias_habiles.feriados`), los mismos de Tareas, Ausencias y el
  rol de pagos (en Nexo, la tabla `Holiday`).
- Los permisos y estados especiales salen de `apps.ausencias.services`.
- La fecha de inicio del KPI de una persona (`User.kpi_start_date` en Nexo)
  es aquí `KpiStartDate`, por empresa (`kpi_start_date_of`).
"""

import json
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from django.db.models import Q
from django.utils import timezone

from apps.ausencias.services import (  # noqa: F401  (los reexporta para el motor)
    get_leave_minutes_by_day,
    get_special_status_day_map,
    get_team_leave_minutes_by_day,
    get_team_special_status_day_map,
    leave_hours_for_day,
    total_leave_minutes,
)
from apps.nomina.dias_habiles import feriados
from apps.novedades.configuracion import get_effective_config_value, set_config_value
from apps.novedades.models import SettingHistory
from apps.tasks import configuracion as tareas
from apps.tasks.configuracion import (  # noqa: F401  (los reexporta para el motor)
    CONFIG_KEY_HORAS_EFECTIVAS,
    CONFIG_KEY_HORAS_ESPERADAS_MES,
    DEFAULT_HORAS_EFECTIVAS,
    DEFAULT_HORAS_ESPERADAS_MES,
    get_effective_horas_efectivas,
    get_effective_horas_esperadas_mes,
)
from apps.tasks.rounding import round_half_up

# ── Límites del semáforo de carga (por día) ─────────────────────────────────

CONFIG_KEY_WORKLOAD_LIMIT_LOW = "workload_limit_low"
DEFAULT_WORKLOAD_LIMIT_LOW = 5.5

CONFIG_KEY_WORKLOAD_LIMIT_HIGH = "workload_limit_high"
DEFAULT_WORKLOAD_LIMIT_HIGH = 7.5

CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD = "workload_limit_overload"
DEFAULT_WORKLOAD_LIMIT_OVERLOAD = 8.5

CONFIG_KEY_ALERT_OVERDUE_TASK_THRESHOLD = "analytics_alert_overdue_task_threshold"
DEFAULT_ALERT_OVERDUE_TASK_THRESHOLD = 3

#: Hora local (huso de negocio) a la que se da por terminada la jornada, para
#: la Capacidad Proyectada.
CONFIG_KEY_WORKDAY_END_HOUR = "capacity_workday_end_hour_local"
DEFAULT_WORKDAY_END_HOUR = 17

#: Ventana histórica de Inteligencia Preventiva (enum cerrado de semanas).
CONFIG_KEY_PREDICTION_WINDOW_WEEKS = "prediction_window_weeks"
DEFAULT_PREDICTION_WINDOW_WEEKS = "3"
PREDICTION_WINDOW_OPTIONS = ("3", "4", "6", "8", "12")


def get_effective_workload_limit_low(as_of: datetime) -> float:
    return get_effective_config_value(
        CONFIG_KEY_WORKLOAD_LIMIT_LOW, as_of, DEFAULT_WORKLOAD_LIMIT_LOW
    )


def get_effective_workload_limit_high(as_of: datetime) -> float:
    return get_effective_config_value(
        CONFIG_KEY_WORKLOAD_LIMIT_HIGH, as_of, DEFAULT_WORKLOAD_LIMIT_HIGH
    )


def get_effective_workload_limit_overload(as_of: datetime) -> float:
    return get_effective_config_value(
        CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD, as_of, DEFAULT_WORKLOAD_LIMIT_OVERLOAD
    )


def get_effective_alert_overdue_task_threshold(as_of: datetime) -> int:
    return int(
        get_effective_config_value(
            CONFIG_KEY_ALERT_OVERDUE_TASK_THRESHOLD, as_of, DEFAULT_ALERT_OVERDUE_TASK_THRESHOLD
        )
    )


def get_effective_workday_end_hour(as_of: datetime) -> int:
    return int(
        get_effective_config_value(CONFIG_KEY_WORKDAY_END_HOUR, as_of, DEFAULT_WORKDAY_END_HOUR)
    )


def get_effective_config_string(key: str, as_of: datetime, fallback: str) -> str:
    """Como `get_effective_config_value` pero para valores no numéricos (el
    JSON de una curva, la ventana de predicción)."""
    record = (
        SettingHistory.objects.filter(key=key, valid_from__lte=as_of)
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=as_of))
        .order_by("-valid_from")
        .first()
    )
    return record.value if record is not None else fallback


def get_effective_prediction_window_weeks(as_of: datetime) -> str:
    return get_effective_config_string(
        CONFIG_KEY_PREDICTION_WINDOW_WEEKS, as_of, DEFAULT_PREDICTION_WINDOW_WEEKS
    )


def get_effective_prediction_window_weeks_number(as_of: datetime) -> int:
    """La ventana como número de semanas; cae al default si lo guardado no es
    una opción reconocida."""
    raw = get_effective_prediction_window_weeks(as_of)
    return int(raw) if raw in PREDICTION_WINDOW_OPTIONS else 3


# ── Objetivo del cargo y Matriz de Compatibilidad Operativa ─────────────────
# JSON en los ajustes, con la clave por rol de Gestión Humana, como en Nexo.


def _role_target_config_key(role_name: str) -> str:
    return f"analytics_role_target_{role_name.lower()}"


def get_effective_role_target(role_name: str, as_of: datetime) -> dict | None:
    raw = get_effective_config_string(_role_target_config_key(role_name), as_of, "")
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None

    def _num(key: str) -> float | None:
        value = parsed.get(key)
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    return {
        "performance": _num("performance"),
        "riesgo_max": _num("riesgo_max"),
        "cumplimiento": _num("cumplimiento"),
    }


def _role_compatibility_config_key(role_name: str) -> str:
    return f"analytics_role_compatibility_{role_name.lower()}"


def get_effective_role_compatibility(role_name: str, as_of: datetime) -> list[str]:
    raw = get_effective_config_string(_role_compatibility_config_key(role_name), as_of, "")
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [r for r in parsed if isinstance(r, str)]


def set_role_target(role_name: str, target: dict, actor) -> None:
    set_config_value(_role_target_config_key(role_name), json.dumps(target), actor)


def get_all_effective_role_targets(roles: list[str], as_of: datetime) -> dict[str, dict | None]:
    return {role: get_effective_role_target(role, as_of) for role in roles}


def set_role_compatibility(role_name: str, compatible_roles: list[str], actor) -> None:
    set_config_value(_role_compatibility_config_key(role_name), json.dumps(compatible_roles), actor)


def get_all_effective_role_compatibility(roles: list[str], as_of: datetime) -> dict[str, list[str]]:
    return {role: get_effective_role_compatibility(role, as_of) for role in roles}


# ── Configuración del motor (pesos, umbrales, límites de predicción) ────────

ANALYTICS_CONFIG_DEFAULTS: dict[str, float] = {
    "health_weight_cumplimiento": 25,
    "health_weight_carga": 25,
    "health_weight_vencidas": 20,
    "health_weight_consistencia": 15,
    "health_weight_capacidad": 15,
    "perf_weight_cumplimiento": 35,
    "perf_weight_vencidas": 25,
    "perf_weight_consistencia": 25,
    "perf_weight_trazabilidad": 15,
    "risk_weight_sobrecarga": 22,
    "risk_weight_vencidas_criticas": 18,
    "risk_weight_tendencia_negativa": 15,
    "risk_weight_horas_extra": 12,
    "risk_weight_baja_capacidad": 11,
    "risk_weight_variabilidad": 10,
    "risk_weight_concentracion": 7,
    "risk_weight_sin_planificacion": 5,
    "risk_threshold_medio": 31,
    "risk_threshold_alto": 61,
    "risk_threshold_critico": 81,
    "alert_overdue_task_threshold": 3,
    "alert_consecutive_overload_days": 3,
    "anomaly_variation_threshold_pct": 30,
    "cache_ttl_minutes": 15,
    "prediction_min_weeks_media": 2,
    "prediction_min_weeks_alta": 4,
}

_ANALYTICS_CONFIG_KEYS: dict[str, str] = {
    name: f"analytics_{name}" for name in ANALYTICS_CONFIG_DEFAULTS
}


def get_effective_analytics_config(as_of: datetime) -> dict[str, float]:
    """La configuración completa del motor vigente en `as_of`."""
    return {
        name: get_effective_config_value(key, as_of, ANALYTICS_CONFIG_DEFAULTS[name])
        for name, key in _ANALYTICS_CONFIG_KEYS.items()
    }


def set_analytics_config_value(name: str, value: float, actor) -> None:
    """`name` es la clave corta (sin el prefijo `analytics_`)."""
    set_config_value(_ANALYTICS_CONFIG_KEYS[name], str(value), actor)


# ── Calendario ──────────────────────────────────────────────────────────────

#: Primer año que se mira en el calendario institucional. En Nexo
#: `get_holiday_set()` devolvía todos los feriados de la tabla, sin rango; aquí
#: los feriados que se repiten cada año se expanden, así que hace falta un
#: rango. Cubre de sobra cualquier historial del motor (el más largo, 16
#: semanas de consistencia y 12 meses de benchmark).
HOLIDAY_FIRST_YEAR = 2000
#: Años hacia adelante desde hoy (para proyecciones y meses futuros).
HOLIDAY_YEARS_AHEAD = 5


def get_holiday_set() -> set[date]:
    """Los feriados de la empresa activa (como `get_holiday_set` de Nexo)."""
    hasta = timezone.now().year + HOLIDAY_YEARS_AHEAD
    return feriados(date(HOLIDAY_FIRST_YEAR, 1, 1), date(hasta, 12, 31))


def holidays_in_year_count(year: int) -> int:
    """Cuántos días feriados tiene el año (en Nexo,
    `Holiday.objects.filter(year=...).count()`: una fila por día)."""
    return len(feriados(date(year, 1, 1), date(year, 12, 31)))


def is_business_day(d: date) -> bool:
    """Lunes a viernes."""
    return d.weekday() < 5


def is_working_day(d: date, holidays: set[date]) -> bool:
    return is_business_day(d) and d not in holidays


def count_business_days(start: date, end: date, holidays: set[date]) -> int:
    count = 0
    current = start
    while current <= end:
        if is_working_day(current, holidays):
            count += 1
        current += timedelta(days=1)
    return count


def expected_hours_per_day_for_month(
    year: int, month: int, holidays: set[date] | None = None
) -> float:
    """Las horas esperadas del MES repartidas entre sus días hábiles (la misma
    regla de Tareas)."""
    holidays = get_holiday_set() if holidays is None else holidays
    return tareas.expected_hours_per_day_for_month(year, month, holidays)


def expected_base_hours_for_range(
    start: date, end: date, holidays: set[date] | None = None
) -> float:
    holidays = get_holiday_set() if holidays is None else holidays
    return tareas.expected_base_hours_for_range(start, end, holidays)


def business_base_for_range(start: date, end: date) -> dict:
    """Réplica de `business_base_for_range` de Nexo, con los límites del
    semáforo que la de Tareas no necesita. El valor vigente al INICIO del
    rango es el que rige. `base_hours` prorratea las horas esperadas del mes;
    los 3 límites externos son umbrales POR DÍA × días hábiles."""
    holidays = get_holiday_set()
    business_days = count_business_days(start, end, holidays)
    as_of = datetime(start.year, start.month, start.day, tzinfo=dt_timezone.utc)
    hours_per_day = get_effective_horas_efectivas(as_of)
    limit_low_per_day = get_effective_workload_limit_low(as_of)
    limit_high_per_day = get_effective_workload_limit_high(as_of)
    limit_overload_per_day = get_effective_workload_limit_overload(as_of)
    base_hours = expected_base_hours_for_range(start, end, holidays)
    expected_per_day = round_half_up(base_hours / business_days, 4) if business_days else 0.0
    return {
        "business_days": business_days,
        "base_hours": base_hours,
        "hours_per_day": hours_per_day,
        "expected_hours_per_day": expected_per_day,
        "limit_low_per_day": limit_low_per_day,
        "limit_high_per_day": limit_high_per_day,
        "limit_overload_per_day": limit_overload_per_day,
        "limit_low_hours": business_days * limit_low_per_day,
        "limit_base_hours": base_hours,
        "limit_high_hours": business_days * limit_high_per_day,
        "limit_overload_hours": business_days * limit_overload_per_day,
    }


# ── Fecha de inicio del KPI de una persona ──────────────────────────────────


def kpi_start_date_of(user) -> datetime | None:
    """Desde cuándo se mide a la persona en la empresa activa (en Nexo,
    `User.kpi_start_date`: medianoche UTC del día)."""
    from .models import KpiStartDate

    if user is None or getattr(user, "pk", None) is None:
        return None
    registro = KpiStartDate.objects.filter(user_id=user.pk).only("kpi_start_date").first()
    return registro.kpi_start_date if registro else None


def kpi_start_dates_for(users) -> dict[int, datetime]:
    """Lo mismo para varias personas en una sola consulta."""
    from .models import KpiStartDate

    ids = [u.pk for u in users]
    if not ids:
        return {}
    return dict(
        KpiStartDate.objects.filter(user_id__in=ids).values_list("user_id", "kpi_start_date")
    )
