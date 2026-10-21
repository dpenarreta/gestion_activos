"""Fechas de los períodos: etiquetas, primer vencimiento y el siguiente (§11.3).

Todo «día» se entiende en la zona horaria de la empresa; lo que se guarda es
el instante en UTC (`Periodo.vence_en`).
"""

import calendar
import datetime

from .models import DE_DIA_Y_MES, Periodicidad

MESES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]

#: Cuánto se adelanta, por defecto, el inicio y la preparación al vencimiento.
DIAS_INICIO = 30
DIAS_PREPARACION = 5

_MESES_POR_PERIODICIDAD = {
    Periodicidad.MENSUAL: 1,
    Periodicidad.TRIMESTRAL: 3,
    Periodicidad.SEMESTRAL: 6,
    Periodicidad.ANUAL: 12,
    Periodicidad.BIENAL: 24,
    Periodicidad.TRIENAL: 36,
    Periodicidad.QUINQUENAL: 60,
    Periodicidad.DECENAL: 120,
}


def etiqueta(periodicidad: str, vencimiento: datetime.date) -> str:
    """«Octubre 2026», «T4 2026», «S2 2026», «Período 2026» o «Período único»,
    según el mes del **vencimiento**."""
    anio = vencimiento.year
    if periodicidad == Periodicidad.MENSUAL:
        return f"{MESES[vencimiento.month - 1]} {anio}"
    if periodicidad == Periodicidad.TRIMESTRAL:
        return f"T{(vencimiento.month - 1) // 3 + 1} {anio}"
    if periodicidad == Periodicidad.SEMESTRAL:
        return f"S{1 if vencimiento.month <= 6 else 2} {anio}"
    if periodicidad in DE_DIA_Y_MES:
        return f"Período {anio}"
    return "Período único"


def _con_dia(anio: int, mes: int, dia: int) -> datetime.date:
    """La fecha con ese día, o el último del mes si no lo tiene (31 → 30, 28)."""
    return datetime.date(anio, mes, min(dia, calendar.monthrange(anio, mes)[1]))


def _sumar_meses(fecha: datetime.date, meses: int, dia: int) -> datetime.date:
    total = fecha.month - 1 + meses
    return _con_dia(fecha.year + total // 12, total % 12 + 1, dia)


def primer_vencimiento(obligacion, hoy: datetime.date) -> datetime.date:
    """Cuando no se indica fecha, el primer vencimiento sale de la regla.

    Anual con día y mes → esa fecha este año, o el siguiente si ya pasó.
    Recurrente con día → ese día este mes, o el siguiente si ya pasó.
    Sin regla → dentro de 30 días.
    """
    dia, mes = obligacion.dia_vencimiento, obligacion.mes_vencimiento
    if obligacion.periodicidad in DE_DIA_Y_MES and dia and mes:
        fecha = _con_dia(hoy.year, mes, dia)
        return fecha if fecha >= hoy else _con_dia(hoy.year + 1, mes, dia)
    if dia and obligacion.periodicidad != Periodicidad.UNICA:
        fecha = _con_dia(hoy.year, hoy.month, dia)
        return fecha if fecha >= hoy else _sumar_meses(fecha, 1, dia)
    return hoy + datetime.timedelta(days=30)


def siguiente_vencimiento(obligacion, anterior: datetime.date) -> datetime.date | None:
    """El vencimiento que sigue a uno dado, o `None` si la obligación es única.

    Suma 1, 3, 6 o 12 meses y usa el día de la plantilla (o el del anterior).
    """
    meses = _MESES_POR_PERIODICIDAD.get(obligacion.periodicidad)
    if meses is None:
        return None
    return _sumar_meses(anterior, meses, obligacion.dia_vencimiento or anterior.day)


def instante(fecha: datetime.date, hora: datetime.time, zona) -> datetime.datetime:
    """La fecha y hora locales de la empresa, como instante (con zona)."""
    return datetime.datetime.combine(fecha, hora, tzinfo=zona)


def fechas_por_defecto(vencimiento: datetime.date) -> tuple[datetime.date, datetime.date]:
    """Inicio y preparación por defecto: 30 y 5 días antes del vencimiento."""
    return (
        vencimiento - datetime.timedelta(days=DIAS_INICIO),
        vencimiento - datetime.timedelta(days=DIAS_PREPARACION),
    )
