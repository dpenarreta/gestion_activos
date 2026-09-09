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

#: Punto de una impresora térmica de 203 dpi. El ancho de barra debe ser un
#: múltiplo exacto: si no lo es, la impresora redondea cada barra por su cuenta
#: y la relación entre anchas y estrechas —que es lo que el lector decodifica—
#: sale distorsionada de forma irregular a lo largo del símbolo.
PUNTO_203_DPI_MM = 25.4 / 203

#: Ancho de módulo mínimo, en milímetros. Dos puntos a 203 dpi. Por debajo de
#: esto una pistola láser de gama común empieza a fallar, y el mismo símbolo
#: que se lee en la pantalla deja de leerse impreso sobre plástico curvo.
X_MINIMA_MM = 2 * PUNTO_203_DPI_MM

#: Ancho de módulo por encima del cual no se sigue engordando el símbolo: más
#: ancho no se lee mejor, solo deja menos sitio para el texto.
X_MAXIMA_MM = 4 * PUNTO_203_DPI_MM

#: Zona muda a cada lado, en módulos. Lo que exige la norma para Code 128, y la
#: causa más común de que una etiqueta «no se deje leer»: sin espacio en blanco
#: antes de la primera barra, el lector no reconoce dónde empieza el símbolo.
QUIET_ZONE_MODULOS = 10

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


def _barra_legible(codigo: str, ancho_disponible: float):
    """Code 128 dimensionado para que lo lea una pistola, no para que quepa.

    Tres reglas, en este orden:

    1. **Zona muda de 10 módulos a cada lado.** Es lo que exige la norma y la
       causa más frecuente de que una etiqueta impresa «no se deje leer»: sin
       blanco antes de la primera barra, el lector no encuentra el inicio del
       símbolo. Antes se dibujaba con `quiet=False` y el símbolo llegaba hasta
       el margen del material.
    2. **Ancho de módulo múltiplo del punto de 203 dpi.** Una impresora térmica
       no puede pintar media barra: si el módulo no es múltiplo exacto del
       punto, redondea cada barra por separado y la proporción entre anchas y
       estrechas —lo que el lector decodifica— se degrada de forma irregular.
    3. **Nunca por debajo de dos puntos** (0,25 mm). Es el suelo por debajo del
       cual una pistola de gama común empieza a fallar sobre material curvo.

    Si con esas tres el símbolo no cabe, se devuelve el más ancho que quepa: es
    preferible una etiqueta apretada a no emitir ninguna, y la validación de
    `caben_en_etiqueta` avisa antes de imprimir un lote entero.
    """
    patron = code128.Code128(
        codigo, barHeight=ALTO_BARRAS_MM * mm, humanReadable=False, quiet=False
    )
    modulos = round(patron.width / patron.barWidth) if patron.barWidth else 0
    if not modulos:
        return patron

    # El ancho se reparte entre el símbolo y sus dos zonas mudas.
    x_que_cabe = ancho_disponible / (modulos + 2 * QUIET_ZONE_MODULOS)

    punto = PUNTO_203_DPI_MM * mm
    x = min(x_que_cabe, X_MAXIMA_MM * mm)
    # Hacia abajo al punto entero más cercano: hacia arriba se saldría.
    x = (int(x / punto) or 1) * punto
    x = max(x, min(X_MINIMA_MM * mm, x_que_cabe))

    return code128.Code128(
        codigo,
        barHeight=ALTO_BARRAS_MM * mm,
        barWidth=x,
        humanReadable=False,
        # `quiet=True` deja las zonas mudas dentro del propio símbolo, así que
        # el ancho que devuelve ya las incluye y centrarlo las respeta.
        quiet=True,
        lquiet=QUIET_ZONE_MODULOS * x,
        rquiet=QUIET_ZONE_MODULOS * x,
    )


def medir_simbolo(codigo: str, dimensiones: DimensionesEtiqueta = DIMENSIONES_POR_DEFECTO) -> dict:
    """Geometría del código tal como saldrá impreso.

    Existe para poder verificarla —en pruebas y desde el panel— sin tener que
    imprimir y escanear: son los tres números que deciden si una pistola lo
    lee.
    """
    ancho_util = (dimensiones.ancho_mm - 2 * dimensiones.margen_mm) * mm
    barra = _barra_legible(codigo, ancho_util)
    return {
        "ancho_modulo_mm": barra.barWidth / mm,
        "ancho_total_mm": barra.width / mm,
        "alto_barras_mm": ALTO_BARRAS_MM,
        "quiet_zone_mm": QUIET_ZONE_MODULOS * barra.barWidth / mm,
        "cabe": barra.width <= ancho_util,
        "cumple_minimo": barra.barWidth / mm >= X_MINIMA_MM,
    }


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

    barra = _barra_legible(activo.codigo_barras, ancho_util)

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
