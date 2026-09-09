"""Reporte en CSV.

Separador coma y BOM UTF-8. La coma es el estándar y es lo que espera
cualquier herramienta que consuma el archivo —que es para lo que sirve un CSV,
porque para leerlo una persona está el .xlsx—. El BOM existe para que Excel no
destroce los acentos al abrirlo de todos modos: sin él, «Ubicación» llega como
«UbicaciÃ³n» y el reporte parece corrupto.

La cabecera de contexto va en líneas comentadas con `#` antes de los datos:
así el archivo dice de qué período es sin romper el parseo por columnas de
quien lo lea salteando esas líneas.
"""

import csv
import io

from django.conf import settings
from django.utils import timezone

BOM = "﻿"


def exportar(reporte, resultado, descripcion_filtros: str) -> bytes:
    salida = io.StringIO()
    escritor = csv.writer(salida, lineterminator="\n")

    escritor.writerow([f"# {reporte.nombre}"])
    escritor.writerow([f"# {reporte.descripcion}"])
    escritor.writerow(
        [
            f"# {settings.SYSTEM_NAME} | emitido el "
            f"{timezone.localtime().strftime('%Y-%m-%d %H:%M')} | "
            f"{resultado['total']} fila(s)"
            + (f" | {descripcion_filtros}" if descripcion_filtros else "")
        ]
    )
    if resultado["truncado"]:
        escritor.writerow(
            [
                f"# ATENCIÓN: se incluyen las primeras {len(resultado['filas'])} de "
                f"{resultado['total']} filas."
            ]
        )

    escritor.writerow([columna.etiqueta for columna in resultado["columnas"]])
    for fila in resultado["filas"]:
        escritor.writerow(["" if valor is None else valor for valor in fila])

    if resultado["totales"]:
        fila_totales = ["" for _ in resultado["columnas"]]
        fila_totales[0] = "TOTAL"
        for posicion, total in resultado["totales"].items():
            fila_totales[posicion] = total
        escritor.writerow(fila_totales)

    return (BOM + salida.getvalue()).encode("utf-8")
