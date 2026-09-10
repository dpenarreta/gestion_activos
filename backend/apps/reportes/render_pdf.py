"""Reporte en PDF, apaisado.

Se dibuja con ReportLab de bajo nivel, igual que las etiquetas y las actas: el
proyecto ya tiene esa dependencia y añadir un motor de plantillas HTML a PDF
por una tabla traería más código del que ahorra.

Apaisado porque un reporte de inventario en A4 vertical solo admite cuatro
columnas legibles. Aun así el PDF muestra un subconjunto de columnas (ver
`columnas_pdf` en el catálogo): este formato es para imprimir, revisar y
firmar; el análisis se hace en el .xlsx.
"""

from io import BytesIO

from django.conf import settings
from django.utils import timezone
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

ANCHO, ALTO = landscape(A4)
MARGEN = 12 * mm
ALTO_FILA = 6 * mm
TAMANO_TEXTO = 7.5
TAMANO_CABECERA = 8


def _recortar(texto: str, ancho_disponible: float, tamano: float) -> str:
    """Corta con puntos suspensivos lo que no cabe en la columna.

    Sin esto los textos largos se pisan entre sí y la tabla se vuelve
    ilegible justo en las columnas que más importan (motivo, descripción).
    """
    if stringWidth(texto, "Helvetica", tamano) <= ancho_disponible:
        return texto
    while texto and stringWidth(texto + "…", "Helvetica", tamano) > ancho_disponible:
        texto = texto[:-1]
    return texto + "…"


def _anchos_de_columna(columnas) -> list[float]:
    """Reparte el ancho útil en proporción al ancho declarado de cada columna."""
    util = ANCHO - 2 * MARGEN
    total = sum(columna.ancho for columna in columnas) or 1
    return [util * columna.ancho / total for columna in columnas]


def _cabecera(pdf, reporte, resultado, descripcion_filtros: str, pagina: int) -> float:
    y = ALTO - MARGEN

    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(MARGEN, y, reporte.nombre)
    pdf.setFont("Helvetica", 8)
    pdf.drawRightString(ANCHO - MARGEN, y, f"Página {pagina}")
    y -= 5 * mm

    pdf.setFont("Helvetica", 8)
    pdf.drawString(MARGEN, y, reporte.descripcion)
    y -= 4.5 * mm

    contexto = (
        f"{settings.SYSTEM_NAME} · emitido el "
        f"{timezone.localtime().strftime('%Y-%m-%d %H:%M')} · {resultado['total']} fila(s)"
    )
    if descripcion_filtros:
        contexto += f" · {descripcion_filtros}"
    pdf.setFont("Helvetica-Oblique", 7.5)
    pdf.drawString(MARGEN, y, _recortar(contexto, ANCHO - 2 * MARGEN, 7.5))
    y -= 4 * mm

    if resultado["truncado"]:
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(
            MARGEN,
            y,
            f"Se imprimen las primeras {len(resultado['filas'])} de "
            f"{resultado['total']} filas. Use el archivo en Excel para verlas todas.",
        )
        y -= 4 * mm

    return y - 2 * mm


def _encabezados(pdf, columnas, anchos, y: float) -> float:
    pdf.setFillColorRGB(0.85, 0.89, 0.95)
    pdf.rect(MARGEN, y - ALTO_FILA + 1.5 * mm, ANCHO - 2 * MARGEN, ALTO_FILA, stroke=0, fill=1)
    pdf.setFillColorRGB(0, 0, 0)

    pdf.setFont("Helvetica-Bold", TAMANO_CABECERA)
    x = MARGEN
    for columna, ancho in zip(columnas, anchos, strict=False):
        pdf.drawString(
            x + 1 * mm, y - 3.8 * mm, _recortar(columna.etiqueta, ancho - 2 * mm, TAMANO_CABECERA)
        )
        x += ancho
    return y - ALTO_FILA


def exportar(reporte, resultado, descripcion_filtros: str) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=landscape(A4))
    pdf.setTitle(reporte.nombre)

    columnas = resultado["columnas"]
    anchos = _anchos_de_columna(columnas)

    pagina = 1
    y = _cabecera(pdf, reporte, resultado, descripcion_filtros, pagina)
    y = _encabezados(pdf, columnas, anchos, y)

    pdf.setFont("Helvetica", TAMANO_TEXTO)
    for numero, fila in enumerate(resultado["filas"]):
        if y < MARGEN + ALTO_FILA * 2:
            pdf.showPage()
            pagina += 1
            y = _cabecera(pdf, reporte, resultado, descripcion_filtros, pagina)
            y = _encabezados(pdf, columnas, anchos, y)
            pdf.setFont("Helvetica", TAMANO_TEXTO)

        # Fondo alterno: en una tabla de doce columnas, seguir una fila con la
        # vista es lo primero que se pierde.
        if numero % 2:
            pdf.setFillColorRGB(0.96, 0.96, 0.96)
            pdf.rect(
                MARGEN, y - ALTO_FILA + 1.5 * mm, ANCHO - 2 * MARGEN, ALTO_FILA, stroke=0, fill=1
            )
            pdf.setFillColorRGB(0, 0, 0)

        x = MARGEN
        for valor, ancho in zip(fila, anchos, strict=False):
            texto = "" if valor is None else str(valor)
            pdf.drawString(x + 1 * mm, y - 3.8 * mm, _recortar(texto, ancho - 2 * mm, TAMANO_TEXTO))
            x += ancho
        y -= ALTO_FILA

    if resultado["totales"]:
        if y < MARGEN + ALTO_FILA * 2:
            pdf.showPage()
            pagina += 1
            y = _cabecera(pdf, reporte, resultado, descripcion_filtros, pagina)
            y = _encabezados(pdf, columnas, anchos, y)

        pdf.setFont("Helvetica-Bold", TAMANO_TEXTO)
        x = MARGEN
        for posicion, ancho in enumerate(anchos):
            if posicion == 0:
                texto = "TOTAL"
            elif posicion in resultado["totales"]:
                texto = str(resultado["totales"][posicion])
            else:
                texto = ""
            pdf.drawString(x + 1 * mm, y - 3.8 * mm, _recortar(texto, ancho - 2 * mm, TAMANO_TEXTO))
            x += ancho

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
