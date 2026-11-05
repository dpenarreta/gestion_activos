"""Dibuja los iconos de la aplicación instalable y el de la pestaña.

Están aquí, en un script, y no pegados como binarios sin origen: dentro de un
año alguien va a querer cambiarlos y este archivo sabe cómo se hicieron. Desde
noviembre de 2026 son el ícono de LAARCOURIER del Brand Book 2026 (página 7,
«Ícono» y «Favicon»): las letras LCE en blanco con la estela amarilla, sobre la
baldosa negra. El dibujo es `src/assets/marca/lce.png` (ver
`scripts/extraer-marca.py`); aquí solo se le pone el fondo y el margen.

Se ejecuta a mano, muy de vez en cuando; lo que se versiona son los PNG que
produce. Necesita Pillow, que ya está en el entorno del backend:

    cd frontend
    ../backend/.venv/Scripts/python scripts/generar-iconos.py

El fondo es `--marca-carbon` de `src/styles/marca.css`. El manifiesto no lee
variables de CSS, y el icono de una aplicación instalada no se retematiza por
empresa —es del producto, no del cliente—.
"""

import pathlib

from PIL import Image, ImageDraw

CARBON = (30, 30, 30)
RAIZ = pathlib.Path(__file__).resolve().parent.parent
GLIFO = RAIZ / "src" / "assets" / "marca" / "lce.png"
DESTINO = RAIZ / "public" / "iconos"


def dibujar(lado: int, margen_relativo: float, redondeo: float = 0.0) -> Image.Image:
    """El glifo centrado sobre el carbón, con `margen_relativo` a cada lado.

    `redondeo` (fracción del lado) recorta las esquinas como la baldosa del
    manual; los iconos que el sistema operativo ya recorta van cuadrados.
    """
    imagen = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    fondo = Image.new("RGBA", (lado, lado), CARBON + (255,))
    mascara = Image.new("L", (lado, lado), 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        [0, 0, lado - 1, lado - 1], radius=int(lado * redondeo), fill=255
    )
    imagen.paste(fondo, (0, 0), mascara)

    glifo = Image.open(GLIFO).convert("RGBA")
    util = lado - 2 * int(lado * margen_relativo)
    escala = util / glifo.width
    glifo = glifo.resize((util, max(1, round(glifo.height * escala))), Image.LANCZOS)
    imagen.alpha_composite(glifo, ((lado - glifo.width) // 2, (lado - glifo.height) // 2))
    return imagen


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)

    for lado in (192, 512):
        dibujar(lado, 0.16, 0.18).save(DESTINO / f"icono-{lado}.png")

    # Android le recorta las esquinas al icono `maskable`, así que el dibujo se
    # encoge al centro —la «zona segura» que la especificación garantiza
    # visible— y el fondo llega a los bordes.
    dibujar(512, 0.24).save(DESTINO / "icono-maskable-512.png")

    # El de la pestaña: casi sin margen, que a 32 píxeles no se ve nada.
    dibujar(32, 0.08, 0.18).save(DESTINO / "favicon-32.png")
    # iOS pone sus propias esquinas.
    dibujar(180, 0.16).save(DESTINO / "apple-touch-icon.png")

    print(f"Iconos escritos en {DESTINO}")


if __name__ == "__main__":
    main()
