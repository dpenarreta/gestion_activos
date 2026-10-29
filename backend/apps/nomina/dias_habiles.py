"""Días hábiles de un mes (aviso del rol de pagos, 29/10/2026).

Hábil es de lunes a viernes y que no sea feriado del calendario institucional
(los `EventoCalendario` de tipo feriado de la empresa activa, que se marcan en
Inicio). Un feriado puede durar varios días (`fecha_fin`) y repetirse cada año
(`cada_anio`): se cuentan todos sus días. No se usan los feriados de la mesa de
ayuda (`apps.soporte.horario`): esos son de su agenda de atención.

Pensado para mirar un mes: el aviso del rol de pagos sale desde el primer día
hábil del mes y cambia cuando pasan los días hábiles permitidos para aceptarlo.
"""

import calendar
import datetime

from apps.organizacion.calendario import _en_el_anio
from apps.organizacion.models import EventoCalendario


def _del_mes(anio: int, mes: int) -> tuple[datetime.date, datetime.date]:
    return datetime.date(anio, mes, 1), datetime.date(anio, mes, calendar.monthrange(anio, mes)[1])


def feriados(desde: datetime.date, hasta: datetime.date) -> set[datetime.date]:
    """Cada día feriado entre `desde` y `hasta` (incluidos)."""
    dias: set[datetime.date] = set()
    for evento in EventoCalendario.objects.filter(tipo=EventoCalendario.Tipo.FERIADO):
        duracion = (evento.fecha_fin - evento.fecha) if evento.fecha_fin else datetime.timedelta()
        if evento.cada_anio:
            # Desde el año anterior: uno de varios días puede empezar en
            # diciembre y terminar en enero.
            inicios = [
                _en_el_anio(evento.fecha, a)
                for a in range(desde.year - 1, hasta.year + 1)
                if a >= evento.fecha.year
            ]
        else:
            inicios = [evento.fecha]
        for inicio in inicios:
            dia = max(inicio, desde)
            fin = min(inicio + duracion, hasta)
            while dia <= fin:
                dias.add(dia)
                dia += datetime.timedelta(days=1)
    return dias


def _habil(fecha: datetime.date, no_laborables: set[datetime.date]) -> bool:
    return fecha.weekday() < 5 and fecha not in no_laborables


def es_habil(fecha: datetime.date) -> bool:
    return _habil(fecha, feriados(fecha, fecha))


def habiles_del_mes(anio: int, mes: int) -> list[datetime.date]:
    desde, hasta = _del_mes(anio, mes)
    no_laborables = feriados(desde, hasta)
    return [
        desde + datetime.timedelta(days=n)
        for n in range((hasta - desde).days + 1)
        if _habil(desde + datetime.timedelta(days=n), no_laborables)
    ]


def primer_dia_habil(anio: int, mes: int) -> datetime.date | None:
    """`None` solo si todo el mes fuera feriado."""
    habiles = habiles_del_mes(anio, mes)
    return habiles[0] if habiles else None


def numero_de_dia_habil(fecha: datetime.date) -> int:
    """Cuántos días hábiles del mes van hasta `fecha`, incluida: 1 el primer
    día hábil, 2 el segundo… Un sábado o un feriado cuenta los transcurridos
    hasta el hábil anterior; antes del primer día hábil es 0."""
    return sum(1 for dia in habiles_del_mes(fecha.year, fecha.month) if dia <= fecha)
