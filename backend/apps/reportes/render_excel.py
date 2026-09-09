"""Reporte en .xlsx.

Lleva una cabecera con el nombre del reporte, los filtros aplicados y la fecha
de emisión. No es adorno: un archivo que circula por correo sin decir de qué
período es y con qué filtros se sacó se interpreta como si fuera el parque
completo, y esa confusión es la que produce decisiones sobre datos que no son.
"""

from io import BytesIO

from django.conf import settings
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

RELLENO_CABECERA = PatternFill("solid", fgColor="D9E2F3")
RELLENO_TOTALES = PatternFill("solid", fgColor="EDEDED")

#: Fila en la que empieza la tabla. Encima va el bloque de contexto.
FILA_ENCABEZADOS = 5


def exportar(reporte, resultado, descripcion_filtros: str) -> bytes:
    libro = Workbook()
    hoja = libro.active
    hoja.title = "Reporte"

    hoja["A1"] = reporte.nombre
    hoja["A1"].font = Font(bold=True, size=14)
    hoja["A2"] = reporte.descripcion
    hoja["A2"].font = Font(italic=True, color="595959")
    hoja["A3"] = (
        f"{settings.SYSTEM_NAME} · emitido el "
        f"{timezone.localtime().strftime('%Y-%m-%d %H:%M')} · "
        f"{resultado['total']} fila(s)"
        + (f" · {descripcion_filtros}" if descripcion_filtros else "")
    )
    hoja["A3"].font = Font(size=9, color="595959")

    if resultado["truncado"]:
        hoja["A4"] = (
            f"Se muestran las primeras {len(resultado['filas'])} de {resultado['total']} filas. "
            "Acote los filtros para verlas todas."
        )
        hoja["A4"].font = Font(size=9, color="9C0006", bold=True)

    columnas = resultado["columnas"]
    for indice, columna in enumerate(columnas, start=1):
        celda = hoja.cell(row=FILA_ENCABEZADOS, column=indice, value=columna.etiqueta)
        celda.font = Font(bold=True)
        celda.fill = RELLENO_CABECERA
        celda.alignment = Alignment(vertical="center", wrap_text=True)
        hoja.column_dimensions[get_column_letter(indice)].width = columna.ancho

    for numero, fila in enumerate(resultado["filas"], start=FILA_ENCABEZADOS + 1):
        for indice, valor in enumerate(fila, start=1):
            hoja.cell(row=numero, column=indice, value=valor)

    if resultado["totales"]:
        fila_totales = FILA_ENCABEZADOS + len(resultado["filas"]) + 1
        etiqueta = hoja.cell(row=fila_totales, column=1, value="TOTAL")
        etiqueta.font = Font(bold=True)
        etiqueta.fill = RELLENO_TOTALES
        for posicion, total in resultado["totales"].items():
            celda = hoja.cell(row=fila_totales, column=posicion + 1, value=total)
            celda.font = Font(bold=True)
            celda.fill = RELLENO_TOTALES

    # La tabla arranca en la fila 6: congelar ahí deja el contexto y los
    # encabezados a la vista mientras se recorre el reporte.
    hoja.freeze_panes = f"A{FILA_ENCABEZADOS + 1}"

    buffer = BytesIO()
    libro.save(buffer)
    return buffer.getvalue()
