"""Fechas del negocio y lectura de fechas de Excel.

Copiado de Nexo (`apps.tasks.business_time` y `apps.tasks.task_import`): solo
lo que usa Control Operativo de Novedades. Puro, sin dependencias de Django.

El módulo trabaja con el día calendario de Ecuador (UTC-5, sin horario de
verano): los plazos de registro y de cierre se cuentan en esa hora, sea cual
sea la zona del servidor.
"""

import math
import re
from datetime import date, datetime, timedelta

#: Horas que hay que restar a UTC para obtener la hora de Ecuador.
BUSINESS_TZ_OFFSET_HOURS = 5

_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_SLASH_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")

#: Los números de serie de fecha de Excel cuentan días desde este día.
_EXCEL_EPOCH = date(1899, 12, 30)


def business_calendar_day(instant: datetime) -> date:
    """El día calendario de negocio (UTC-5) al que pertenece `instant`."""
    shifted = instant - timedelta(hours=BUSINESS_TZ_OFFSET_HOURS)
    return shifted.date()


def _is_valid_date(year: int, month: int, day: int) -> bool:
    if month < 1 or month > 12 or day < 1 or day > 31:
        return False
    try:
        date(year, month, day)
    except ValueError:
        return False
    return True


def _excel_serial_to_date(serial: float) -> date | None:
    """Serial de fecha de Excel → fecha. Redondea como `Math.round` de
    JavaScript (mitad hacia arriba), igual que en Nexo."""
    try:
        return _EXCEL_EPOCH + timedelta(days=math.floor(serial + 0.5))
    except (OverflowError, ValueError):
        return None


def parse_date(value) -> date | None:
    """Fecha de una celda de Excel: `datetime`/`date` nativos de openpyxl,
    serial numérico, `AAAA-MM-DD` o `DD/MM/AAAA` (y, si no cabe, `MM/DD/AAAA`).
    `None` si no se reconoce."""
    if value is None or value == "":
        return None

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _excel_serial_to_date(value)

    text = str(value).strip()
    if not text:
        return None

    match = _ISO_RE.match(text)
    if match:
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        return date(year, month, day) if _is_valid_date(year, month, day) else None

    match = _SLASH_RE.match(text)
    if match:
        a, b, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if _is_valid_date(year, b, a):
            return date(year, b, a)
        if _is_valid_date(year, a, b):
            return date(year, a, b)
        return None

    return None
