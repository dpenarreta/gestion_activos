"""Ajustes de Tareas con vigencia, por empresa.

Sustituye lo que Tareas usaba de `apps.configuration` de Nexo. Reutiliza la
tabla de ajustes con vigencia de Gestión Humana (`novedades.SettingHistory`,
ver `apps.novedades.configuracion`): mismo comportamiento que en Nexo —el
valor que rige un cálculo es el vigente en un instante, así que un cambio no
altera lo ya calculado— y una sola tabla para todo el módulo.

Las claves numéricas son las mismas de Nexo para migrar sus datos tal cual.

De `apps.configuration` NO se trae `LeaveRecord` ni `SpecialStatus`: Tareas y
Equipo no los usan (solo los usan Carga laboral y KPI, que no son de esta
fase). Tampoco las reglas de aviso por rol de los comentarios
(`comment_targets`): ahora avisa el organigrama (`jerarquia.jefe_inmediato`).
"""

import calendar
import json
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

from apps.nomina.dias_habiles import feriados
from apps.novedades.configuracion import (
    current_record,
    get_effective_config_value,
    set_config_value,
)

from .roles import ALL_ROLES, COORDINADOR_NACIONAL
from .rounding import round_half_up

CONFIG_KEY_HORAS_EFECTIVAS = "HORAS_EFECTIVAS_DIA"
DEFAULT_HORAS_EFECTIVAS = 6.5

CONFIG_KEY_HORAS_ESPERADAS_MES = "HORAS_ESPERADAS_MES"
DEFAULT_HORAS_ESPERADAS_MES = 140.0

CONFIG_KEY_RETROACTIVE_WINDOW_DAYS = "retroactive_window_business_days"
DEFAULT_RETROACTIVE_WINDOW_DAYS = 2

#: Reglas de aviso que en Nexo vivían en `notification_rules` (JSON). Aquí van
#: en dos claves, porque `SettingHistory.value` admite 255 caracteres.
CONFIG_KEY_FIRST_COMMENT_ROLE = "tasks_first_comment_role"
CONFIG_KEY_RETROACTIVE_NOTIFY_ROLES = "tasks_retroactive_notify_roles"
DEFAULT_RETROACTIVE_NOTIFY_ROLES = [COORDINADOR_NACIONAL]

#: A quién se avisa de un registro retroactivo de horas (05/11/2026): por
#: defecto (lista vacía) al jefe inmediato de quien registra, según el
#: organigrama; quien administra puede elegir personas concretas. Reemplaza al
#: aviso por rol de Nexo (`tasks_retroactive_notify_roles`, ya sin uso).
CONFIG_KEY_RETROACTIVE_NOTIFY_USERS = "tasks_retroactive_notify_users"
#: Tope de personas: los ids van como JSON en `SettingHistory.value` (255).
MAX_RETROACTIVE_NOTIFY_USERS = 25


def get_effective_horas_efectivas(as_of: datetime) -> float:
    return get_effective_config_value(CONFIG_KEY_HORAS_EFECTIVAS, as_of, DEFAULT_HORAS_EFECTIVAS)


def get_effective_horas_esperadas_mes(as_of: datetime) -> float:
    return get_effective_config_value(
        CONFIG_KEY_HORAS_ESPERADAS_MES, as_of, DEFAULT_HORAS_ESPERADAS_MES
    )


def get_effective_retroactive_window_days(as_of: datetime) -> int:
    value = get_effective_config_value(
        CONFIG_KEY_RETROACTIVE_WINDOW_DAYS, as_of, DEFAULT_RETROACTIVE_WINDOW_DAYS
    )
    return max(int(value), 1)


def _current_text(key: str) -> str | None:
    record = current_record(key)
    return record.value if record else None


def get_first_comment_role() -> str | None:
    """Rol que además recibe aviso del PRIMER comentario de una tarea (vacío
    por defecto, como en Nexo)."""
    value = _current_text(CONFIG_KEY_FIRST_COMMENT_ROLE)
    return value if value in ALL_ROLES else None


def get_retroactive_notify_roles() -> list[str]:
    """Roles a los que se avisa de un registro retroactivo de horas (en Nexo,
    por defecto el Coordinador Nacional)."""
    raw = _current_text(CONFIG_KEY_RETROACTIVE_NOTIFY_ROLES)
    if raw is None:
        return list(DEFAULT_RETROACTIVE_NOTIFY_ROLES)
    try:
        roles = json.loads(raw)
    except (TypeError, ValueError):
        return list(DEFAULT_RETROACTIVE_NOTIFY_ROLES)
    if not isinstance(roles, list):
        return list(DEFAULT_RETROACTIVE_NOTIFY_ROLES)
    return [rol for rol in roles if rol in ALL_ROLES]


def get_retroactive_notify_users() -> list[int]:
    """Ids de las personas elegidas para el aviso retroactivo; vacía = el jefe
    inmediato de quien registra."""
    raw = _current_text(CONFIG_KEY_RETROACTIVE_NOTIFY_USERS)
    if not raw:
        return []
    try:
        ids = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(ids, list):
        return []
    return [int(i) for i in ids if isinstance(i, int) or str(i).isdigit()]


def current_settings() -> dict:
    now = timezone.now()
    return {
        "retroactive_window_business_days": get_effective_retroactive_window_days(now),
        "horas_efectivas_dia": get_effective_horas_efectivas(now),
        "horas_esperadas_mes": get_effective_horas_esperadas_mes(now),
        "first_comment_role": get_first_comment_role(),
        "retroactive_notify_users": get_retroactive_notify_users(),
    }


def save_settings(values: dict, actor) -> None:
    """Guarda los ajustes presentes en `values` (ya validados)."""
    if "retroactive_window_business_days" in values:
        set_config_value(
            CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
            str(values["retroactive_window_business_days"]),
            actor,
        )
    if "horas_efectivas_dia" in values:
        set_config_value(CONFIG_KEY_HORAS_EFECTIVAS, str(values["horas_efectivas_dia"]), actor)
    if "horas_esperadas_mes" in values:
        set_config_value(CONFIG_KEY_HORAS_ESPERADAS_MES, str(values["horas_esperadas_mes"]), actor)
    if "first_comment_role" in values:
        set_config_value(CONFIG_KEY_FIRST_COMMENT_ROLE, values["first_comment_role"] or "", actor)
    if "retroactive_notify_users" in values:
        set_config_value(
            CONFIG_KEY_RETROACTIVE_NOTIFY_USERS,
            json.dumps(values["retroactive_notify_users"]),
            actor,
        )


# ── Días hábiles y base de horas (cierre de mes) ─────────────────────────────


def is_business_day(d: date) -> bool:
    """Lunes a viernes."""
    return d.weekday() < 5


def count_business_days(start: date, end: date, holidays: set[date]) -> int:
    count, current = 0, start
    while current <= end:
        if is_business_day(current) and current not in holidays:
            count += 1
        current += timedelta(days=1)
    return count


def expected_hours_per_day_for_month(year: int, month: int, holidays: set[date]) -> float:
    """Reparte las horas esperadas del MES entre sus días hábiles: el divisor
    es siempre el mes calendario completo, así un mes entero suma exactamente
    las horas esperadas y cualquier tramo queda prorrateado."""
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    business_days = count_business_days(month_start, month_end, holidays)
    if business_days <= 0:
        return 0.0
    as_of = datetime(year, month, 1, tzinfo=dt_timezone.utc)
    return get_effective_horas_esperadas_mes(as_of) / business_days


def expected_base_hours_for_range(start: date, end: date, holidays: set[date]) -> float:
    """Horas esperadas de `[start, end]`, mes por mes (cada mes tiene su tasa)."""
    total, cursor = 0.0, start
    while cursor <= end:
        month_end = date(
            cursor.year, cursor.month, calendar.monthrange(cursor.year, cursor.month)[1]
        )
        segment_end = min(end, month_end)
        segment_days = count_business_days(cursor, segment_end, holidays)
        if segment_days:
            total += segment_days * expected_hours_per_day_for_month(
                cursor.year, cursor.month, holidays
            )
        cursor = month_end + timedelta(days=1)
    return round_half_up(total, 2)


def business_base_for_range(start: date, end: date) -> dict:
    """Días hábiles y horas base del tramo (lo que el cierre de mes congela).

    Los feriados son los del calendario institucional de la empresa activa
    (`apps.nomina.dias_habiles`, el mismo que usan Novedades y el rol de
    pagos). Se toman los de los meses completos del tramo, porque la tasa
    diaria divide entre todos los días hábiles del mes."""
    first = date(start.year, start.month, 1)
    last = date(end.year, end.month, calendar.monthrange(end.year, end.month)[1])
    holidays = feriados(first, last)
    business_days = count_business_days(start, end, holidays)
    as_of = datetime(start.year, start.month, start.day, tzinfo=dt_timezone.utc)
    base_hours = expected_base_hours_for_range(start, end, holidays)
    return {
        "business_days": business_days,
        "base_hours": base_hours,
        "hours_per_day": get_effective_horas_efectivas(as_of),
        "expected_hours_per_day": (
            round_half_up(base_hours / business_days, 4) if business_days else 0.0
        ),
    }
