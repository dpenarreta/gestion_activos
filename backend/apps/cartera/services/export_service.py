"""Exportación a Excel/CSV con sanitización anti-inyección de fórmulas (sección 17)."""

import csv
import io

from openpyxl import Workbook

CARACTERES_PELIGROSOS = ('=', '+', '-', '@', '\t', '\r')


def sanitizar_valor(valor):
    if isinstance(valor, str) and valor and valor[0] in CARACTERES_PELIGROSOS:
        return "'" + valor
    return valor


def generar_excel(filas, columnas, nombre_hoja='Detalle'):
    """columnas: lista de tuplas (clave, encabezado). filas: lista de dicts."""
    wb = Workbook()
    ws = wb.active
    ws.title = nombre_hoja[:31] or 'Detalle'

    ws.append([encabezado for _, encabezado in columnas])
    for fila in filas:
        ws.append([sanitizar_valor(fila.get(clave, '')) for clave, _ in columnas])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


def generar_csv(filas, columnas):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([encabezado for _, encabezado in columnas])
    for fila in filas:
        writer.writerow([sanitizar_valor(fila.get(clave, '')) for clave, _ in columnas])

    data = buffer.getvalue().encode('utf-8-sig')
    return io.BytesIO(data)


COLUMNAS_DETALLE = [
    ('cliente', 'Cliente'),
    ('ruc_cliente', 'RUC'),
    ('numero_documento', 'Número de documento'),
    ('fecha_emision', 'Fecha de emisión'),
    ('fecha_vencimiento', 'Fecha de vencimiento'),
    ('dias_vencidos', 'Días vencidos'),
    ('saldo', 'Saldo'),
    ('ciudad', 'Ciudad'),
    ('recuperador', 'Recuperador'),
    ('causal', 'Causal'),
    ('estado_calculado', 'Estado'),
    ('rango_mora', 'Rango de mora'),
]

COLUMNAS_ERRORES = [
    ('fila', 'Fila en el Excel'),
    ('motivo', 'Motivo'),
]
