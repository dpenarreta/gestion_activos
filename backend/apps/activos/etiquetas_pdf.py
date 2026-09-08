"""Generación de las etiquetas de activos en PDF (RF-08).

Complementa a `apps.activos.etiquetas`, que produce los trabajos de impresión
directa (ZPL/TSPL). Los dos formatos responden a usos distintos y por eso
conviven:

- **ZPL/TSPL** se envía a la cola de una impresora térmica concreta y sale
  exactamente del tamaño del rollo, pero solo lo entiende esa familia de
  impresoras y no se puede revisar ni archivar.
- **PDF** lo abre cualquiera, se puede previsualizar antes de gastar
  consumibles, se adjunta a un correo y sirve también para imprimir en una
  impresora común cuando la térmica no está disponible.

El código de barras se dibuja con `reportlab.graphics.barcode.code128`, que
produce un Code 128 real y escaneable a partir del valor: no es una imagen
decorativa. La página tiene el tamaño físico de la etiqueta (50 × 25 mm por
defecto), así que al imprimir "a tamaño real" sale a escala correcta.
"""

from io import BytesIO

from reportlab.graphics.barcode import code128
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from .etiquetas import DIMENSIONES_POR_DEFECTO, DimensionesEtiqueta

# Altura de las barras. Por debajo de ~8 mm, un lector de mano necesita
# demasiada precisión de apuntado sobre una etiqueta pequeña.
ALTO_BARRAS_MM = 9.0

FUENTE_NOMBRE = "Helvetica-Bold"
FUENTE_DETALLE = "Helvetica"


def _ajustar_texto(pdf, texto: str, ancho_disponible: float, fuente: str, tamano: float) -> str:
    """Recorta el texto con puntos suspensivos si no cabe en el ancho dado.

    Una etiqueta impresa no puede desbordar ni reflowear: lo que no entra
    simplemente se pierde fuera del material, así que es preferible truncar de
    forma visible a que el nombre salga cortado a la mitad de una letra.
    """
    if pdf.stringWidth(texto, fuente, tamano) <= ancho_disponible:
        return texto

    puntos = "…"
    recortado = texto
    while recortado and pdf.stringWidth(recortado + puntos, fuente, tamano) > ancho_disponible:
        recortado = recortado[:-1]
    return (recortado + puntos) if recortado else puntos


def _dibujar_etiqueta(pdf, activo, dimensiones: DimensionesEtiqueta) -> None:
    """Pinta una etiqueta en la página actual del canvas."""
    ancho = dimensiones.ancho_mm * mm
    alto = dimensiones.alto_mm * mm
    margen = dimensiones.margen_mm * mm
    ancho_util = ancho - (2 * margen)

    nombre = activo.nombre or ""
    area = activo.departamento.nombre if activo.departamento_id else ""

    # De arriba abajo: nombre, área, código de barras y su valor legible.
    cursor = alto - margen

    tamano_nombre = 7.5
    cursor -= tamano_nombre
    pdf.setFont(FUENTE_NOMBRE, tamano_nombre)
    pdf.drawString(
        margen, cursor, _ajustar_texto(pdf, nombre, ancho_util, FUENTE_NOMBRE, tamano_nombre)
    )

    tamano_area = 6
    cursor -= tamano_area + 1.5
    pdf.setFont(FUENTE_DETALLE, tamano_area)
    pdf.drawString(
        margen, cursor, _ajustar_texto(pdf, area, ancho_util, FUENTE_DETALLE, tamano_area)
    )

    # El símbolo se escala para ocupar el ancho útil, tanto si sobra como si
    # falta: con un ancho de barra fijo, un código largo se saldría del
    # material y uno corto quedaría innecesariamente angosto, y cuanto más
    # fina es la barra más precisión de apuntado necesita el lector.
    barra = code128.Code128(
        activo.codigo_barras,
        barHeight=ALTO_BARRAS_MM * mm,
        humanReadable=False,
        quiet=False,
    )
    if barra.width > 0:
        barra = code128.Code128(
            activo.codigo_barras,
            barHeight=ALTO_BARRAS_MM * mm,
            barWidth=barra.barWidth * (ancho_util / barra.width),
            humanReadable=False,
            quiet=False,
        )

    tamano_codigo = 6
    # Se reserva el espacio del texto legible antes de posicionar las barras.
    y_barras = margen + tamano_codigo + 1.5
    barra.drawOn(pdf, margen + (ancho_util - barra.width) / 2, y_barras)

    # El valor en texto bajo las barras: si el código se raya o el lector
    # falla, sigue siendo posible teclearlo o dictarlo.
    pdf.setFont(FUENTE_DETALLE, tamano_codigo)
    pdf.drawCentredString(ancho / 2, margen, activo.codigo_barras)


def construir_pdf(activos, dimensiones: DimensionesEtiqueta = DIMENSIONES_POR_DEFECTO) -> bytes:
    """PDF con una etiqueta por página, a tamaño físico real.

    Una página por etiqueta (y no varias en una hoja A4) porque el destino
    normal es una impresora de rollo, que corta por página. Para imprimir en
    hoja común, el diálogo de impresión del visor ofrece "varias páginas por
    hoja".
    """
    buffer = BytesIO()
    ancho = dimensiones.ancho_mm * mm
    alto = dimensiones.alto_mm * mm

    pdf = canvas.Canvas(buffer, pagesize=(ancho, alto))
    pdf.setTitle(
        f"Etiqueta {activos[0].codigo_barras}"
        if len(activos) == 1
        else f"Etiquetas de activos ({len(activos)})"
    )

    for activo in activos:
        _dibujar_etiqueta(pdf, activo, dimensiones)
        pdf.showPage()

    pdf.save()
    return buffer.getvalue()
