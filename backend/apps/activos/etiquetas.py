"""Generación del contenido de las etiquetas térmicas (RF-08).

Se emiten los dos lenguajes de impresión directa más extendidos:

- **ZPL** (Zebra y compatibles), en dots. A 203 dpi, 8 dots = 1 mm.
- **TSPL** (TSC, Godex y compatibles), que acepta milímetros en `SIZE` pero
  posiciona en dots igual que ZPL.

Ninguno de los dos se envía a la impresora desde aquí. El backend produce el
texto del trabajo y la capa HTTP lo entrega como archivo descargable; el
operador lo manda a la cola de impresión (`lpr`, `copy /b` a un puerto, o el
utilitario del fabricante). Abrir un socket 9100 contra una IP arbitraria
desde el servidor convertiría este endpoint en un pivote de red —cualquiera
con permiso de imprimir podría alcanzar hosts internos—, y ese riesgo no se
justifica para ahorrar un paso manual.

Las medidas por defecto (50 x 25 mm) corresponden a la etiqueta de activo fijo
más común. Son parámetros, no constantes ocultas: `dimensiones_mm` las cambia
sin tocar el código.
"""

from dataclasses import dataclass

DPI = 203
DOTS_POR_MM = DPI / 25.4


@dataclass(frozen=True)
class DimensionesEtiqueta:
    """Medidas físicas de la etiqueta, en milímetros."""

    ancho_mm: float = 50.0
    alto_mm: float = 25.0
    margen_mm: float = 2.0

    @property
    def ancho_dots(self) -> int:
        return round(self.ancho_mm * DOTS_POR_MM)

    @property
    def alto_dots(self) -> int:
        return round(self.alto_mm * DOTS_POR_MM)

    @property
    def margen_dots(self) -> int:
        return round(self.margen_mm * DOTS_POR_MM)


DIMENSIONES_POR_DEFECTO = DimensionesEtiqueta()


def _sanear(texto: str, limite: int) -> str:
    """Recorta y limpia un texto para que quepa en la etiqueta.

    Elimina los caracteres de control que actuarían como delimitadores dentro
    del propio lenguaje de impresión (`^` y `~` en ZPL, comillas y saltos de
    línea en TSPL): un nombre de activo con un acento circunflejo no debe
    poder inyectar un comando en el trabajo de impresión.
    """
    limpio = (texto or "").replace("^", " ").replace("~", " ").replace('"', " ")
    limpio = " ".join(limpio.split())
    return limpio[:limite]


def construir_zpl(
    *,
    codigo_barras: str,
    nombre_activo: str,
    area: str,
    dimensiones: DimensionesEtiqueta = DIMENSIONES_POR_DEFECTO,
) -> str:
    """Trabajo de impresión ZPL para una etiqueta.

    `^BY2` fija el módulo del Code 128 en 2 dots: con 1 dot la barra queda por
    debajo de lo que un lector barato resuelve de forma fiable, y con 3 el
    código no entra en 50 mm.
    """
    nombre = _sanear(nombre_activo, 28)
    area_txt = _sanear(area, 28)
    codigo = _sanear(codigo_barras, 40)
    margen = dimensiones.margen_dots

    return "\n".join(
        [
            "^XA",
            f"^PW{dimensiones.ancho_dots}",
            f"^LL{dimensiones.alto_dots}",
            "^LH0,0",
            "^CI28",  # UTF-8: sin esto los acentos salen como basura.
            f"^FO{margen},{margen}^A0N,22,22^FD{nombre}^FS",
            f"^FO{margen},{margen + 26}^A0N,18,18^FD{area_txt}^FS",
            "^BY2,3,50",
            f"^FO{margen},{margen + 50}^BCN,50,Y,N,N^FD{codigo}^FS",
            "^XZ",
        ]
    )


def construir_tspl(
    *,
    codigo_barras: str,
    nombre_activo: str,
    area: str,
    dimensiones: DimensionesEtiqueta = DIMENSIONES_POR_DEFECTO,
) -> str:
    """Trabajo de impresión TSPL para la misma etiqueta."""
    nombre = _sanear(nombre_activo, 28)
    area_txt = _sanear(area, 28)
    codigo = _sanear(codigo_barras, 40)
    margen = dimensiones.margen_dots

    return "\n".join(
        [
            f"SIZE {dimensiones.ancho_mm} mm, {dimensiones.alto_mm} mm",
            "GAP 2 mm, 0 mm",
            "DIRECTION 1",
            "CLS",
            f'TEXT {margen},{margen},"3",0,1,1,"{nombre}"',
            f'TEXT {margen},{margen + 26},"2",0,1,1,"{area_txt}"',
            f'BARCODE {margen},{margen + 50},"128",50,1,0,2,2,"{codigo}"',
            "PRINT 1,1",
        ]
    )


CONSTRUCTORES = {
    "zpl": construir_zpl,
    "tspl": construir_tspl,
}

EXTENSIONES = {
    "zpl": "zpl",
    "tspl": "txt",
}


def construir_etiqueta(lenguaje: str, **kwargs) -> str:
    """Despacha al constructor del lenguaje pedido."""
    try:
        constructor = CONSTRUCTORES[lenguaje]
    except KeyError:
        raise ValueError(
            f"Lenguaje de impresión no soportado: {lenguaje!r}. "
            f"Opciones: {', '.join(sorted(CONSTRUCTORES))}."
        ) from None
    return constructor(**kwargs)


def construir_lote(lenguaje: str, activos, dimensiones=DIMENSIONES_POR_DEFECTO) -> str:
    """Un solo trabajo con las etiquetas de varios activos, en orden.

    Concatenar es correcto en ambos lenguajes: ZPL delimita cada etiqueta entre
    `^XA`/`^XZ` y TSPL entre `CLS`/`PRINT`, así que la impresora las procesa
    secuencialmente sin necesidad de un envío por activo.
    """
    partes = [
        construir_etiqueta(
            lenguaje,
            codigo_barras=activo.codigo_barras,
            nombre_activo=activo.nombre,
            area=activo.departamento.nombre if activo.departamento_id else "",
            dimensiones=dimensiones,
        )
        for activo in activos
    ]
    return "\n".join(partes)
