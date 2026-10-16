"""Cálculo de fecha de corte, parseo de fechas y rangos de mora (secciones 7, 8 y 11)."""

import calendar
import datetime as dt

import pandas as pd
from dateutil import parser as dateutil_parser

EXCEL_EPOCH = dt.date(1899, 12, 30)

RANGOS_MORA = [
    'POR VENCER',
    '0-30 DÍAS',
    '31-60 DÍAS',
    '61-90 DÍAS',
    '91-120 DÍAS',
    '121-180 DÍAS',
    '181-360 DÍAS',
    'MÁS DE 360 DÍAS',
    'SIN FECHA',
]


def fecha_corte_por_defecto(fecha_referencia=None):
    """Último día calendario del mes anterior a la fecha de referencia (por defecto, hoy)."""
    hoy = fecha_referencia or dt.date.today()
    primer_dia_mes_actual = hoy.replace(day=1)
    return primer_dia_mes_actual - dt.timedelta(days=1)


def parse_fecha(value):
    """Convierte un valor de celda de Excel (datetime, date, texto o serial numérico) a date, o None."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, (int, float)):
        try:
            return EXCEL_EPOCH + dt.timedelta(days=float(value))
        except (OverflowError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return dateutil_parser.parse(text, dayfirst=False).date()
    except (ValueError, OverflowError):
        try:
            return dateutil_parser.parse(text, dayfirst=True).date()
        except (ValueError, OverflowError):
            return None


def a_fecha(valor):
    """Normaliza a `date` un valor de fecha que puede venir como `date`, `datetime` o
    `pandas.Timestamp`; devuelve `None` para vacíos (`None`/`NaT`/`NaN`).

    Existe porque el mismo dato llega con tipos distintos según el origen: el ORM entrega `date`,
    pero `pd.read_excel` y `pd.to_datetime` convierten las columnas de fecha a `datetime64`, cuyos
    valores son `Timestamp`. Mezclar los dos tipos en una comparación falla —`date <= Timestamp`
    levanta `TypeError`— así que conviene normalizar una vez, en el borde, en vez de defenderse en
    cada operación. `Timestamp` es subclase de `datetime`, con lo que el `isinstance` cubre ambos.
    """
    if valor is None or pd.isna(valor):
        return None
    if isinstance(valor, dt.datetime):
        return valor.date()
    return valor


def calcular_dias_vencidos(fecha_vencimiento, fecha_corte):
    fecha_vencimiento = a_fecha(fecha_vencimiento)
    if fecha_vencimiento is None:
        return None
    return (fecha_corte - fecha_vencimiento).days


def calcular_rango_mora(fecha_vencimiento, fecha_corte):
    dias = calcular_dias_vencidos(fecha_vencimiento, fecha_corte)
    if dias is None:
        return 'SIN FECHA'
    if dias < 0:
        return 'POR VENCER'
    if dias <= 30:
        return '0-30 DÍAS'
    if dias <= 60:
        return '31-60 DÍAS'
    if dias <= 90:
        return '61-90 DÍAS'
    if dias <= 120:
        return '91-120 DÍAS'
    if dias <= 180:
        return '121-180 DÍAS'
    if dias <= 360:
        return '181-360 DÍAS'
    return 'MÁS DE 360 DÍAS'


def ultimo_dia_mes(anio, mes):
    return dt.date(anio, mes, calendar.monthrange(anio, mes)[1])
