"""Dibuja los iconos de la aplicación instalable.

Están aquí, en un script, y no pegados como binarios sin origen: dentro de un
año alguien va a querer cambiarlos —otro color, otro dibujo— y este archivo
sabe cómo se hicieron. El motivo es una etiqueta de código de barras, que es lo
que la aplicación hace y lo que se reconoce de un vistazo entre los demás
iconos de una pantalla de inicio.

Se ejecuta a mano, muy de vez en cuando; lo que se versiona son los PNG que
produce. Necesita Pillow, que ya está en el entorno del backend:

    cd frontend
    ../backend/.venv/Scripts/python scripts/generar-iconos.py

El color es `--brand-primary` de `src/styles/brand.css`. Si la identidad visual
cambia, cambia aquí también: el manifiesto no lee variables de CSS, y el icono
de una aplicación instalada no se retematiza por empresa —es del producto, no
del cliente—.
"""

import pathlib

from PIL import Image, ImageDraw

AZUL = (13, 110, 253)
BLANCO = (255, 255, 255)
DESTINO = pathlib.Path(__file__).resolve().parent.parent / "public" / "iconos"

#: Anchos alternos de barra y espacio, como en un código real. No codifica nada:
#: un código legible invitaría a escanear el icono.
BARRAS = [3, 1, 1, 2, 1, 3, 1, 1, 2, 2, 1, 1, 3, 1, 2, 1, 1, 2]


def dibujar(lado: int, margen_relativo: float) -> Image.Image:
    imagen = Image.new("RGBA", (lado, lado), AZUL + (255,))
    lienzo = ImageDraw.Draw(imagen)

    margen = int(lado * margen_relativo)
    util = lado - 2 * margen
    alto = int(util * 0.62)
    arriba = margen + (util - alto) // 2

    unidad = util / sum(BARRAS)
    x = margen
    for indice, ancho in enumerate(BARRAS):
        if indice % 2 == 0:  # las pares son barra; las impares, espacio
            lienzo.rectangle(
                [round(x), arriba, round(x + ancho * unidad) - 1, arriba + alto],
                fill=BLANCO,
            )
        x += ancho * unidad
    return imagen


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)

    # Con su propio margen, para que se vea completo sobre cualquier fondo.
    for lado in (192, 512):
        dibujar(lado, 0.16).save(DESTINO / f"icono-{lado}.png")

    # Android le recorta las esquinas al icono `maskable`, así que el dibujo se
    # encoge al centro —la «zona segura» que la especificación garantiza
    # visible—. Sin una versión así, el sistema mete el cuadrado dentro de un
    # círculo blanco y parece un icono mal puesto.
    dibujar(512, 0.26).save(DESTINO / "icono-maskable-512.png")

    # El de la pestaña: sin margen, que a 32 píxeles no se ve nada.
    dibujar(32, 0.06).save(DESTINO / "favicon-32.png")
    dibujar(180, 0.16).save(DESTINO / "apple-touch-icon.png")

    print(f"Iconos escritos en {DESTINO}")


if __name__ == "__main__":
    main()
