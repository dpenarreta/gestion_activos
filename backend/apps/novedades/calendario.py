"""Feriados y días hábiles del módulo.

En Nexo los feriados venían de `configuration.Holiday`; en la intranet salen
del calendario institucional de la empresa activa (los `EventoCalendario` de
tipo feriado que se marcan en Inicio), el mismo que usa el rol de pagos
(`apps.nomina.dias_habiles`). Un feriado puede durar varios días y repetirse
cada año: cuentan todos sus días.

Hábil = lunes a viernes que no es feriado. Es la regla con que se cuentan los
plazos de registro y el plazo de cierre de Horas extras.
"""

import datetime

from django.utils import timezone

from apps.nomina.dias_habiles import feriados
from apps.organizacion.calendario import _en_el_anio
from apps.organizacion.models import EventoCalendario

#: Años hacia atrás y hacia adelante que cubre el conjunto de feriados: los
#: plazos se calculan para fechas de los últimos 24 meses (selector de meses)
#: y avanzan, como mucho, unas semanas.
_ANIOS_ATRAS = 3
_ANIOS_ADELANTE = 1


def holidays_named(desde: datetime.date, hasta: datetime.date) -> dict[datetime.date, str]:
    """Cada día feriado entre `desde` y `hasta` (incluidos), con su nombre."""
    dias: dict[datetime.date, str] = {}
    for evento in EventoCalendario.objects.filter(tipo=EventoCalendario.Tipo.FERIADO):
        duracion = (evento.fecha_fin - evento.fecha) if evento.fecha_fin else datetime.timedelta()
        if evento.cada_anio:
            # Desde el año anterior: uno de varios días puede empezar en
            # diciembre y terminar en enero.
            inicios = [
                _en_el_anio(evento.fecha, anio)
                for anio in range(desde.year - 1, hasta.year + 1)
                if anio >= evento.fecha.year
            ]
        else:
            inicios = [evento.fecha]
        for inicio in inicios:
            dia = max(inicio, desde)
            fin = min(inicio + duracion, hasta)
            while dia <= fin:
                dias.setdefault(dia, evento.titulo)
                dia += datetime.timedelta(days=1)
    return dias


def get_holiday_set() -> set[datetime.date]:
    """Los feriados de la empresa activa alrededor de hoy (ver `_ANIOS_*`)."""
    hoy = timezone.now().date()
    return feriados(
        datetime.date(hoy.year - _ANIOS_ATRAS, 1, 1),
        datetime.date(hoy.year + _ANIOS_ADELANTE, 12, 31),
    )


def is_holiday(day: datetime.date) -> bool:
    return bool(feriados(day, day))


def is_business_day(day: datetime.date) -> bool:
    """Lunes a viernes."""
    return day.weekday() < 5


def is_working_day(day: datetime.date, holidays: set[datetime.date]) -> bool:
    return is_business_day(day) and day not in holidays
