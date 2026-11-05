"""Saca del Brand Book 2026 de LAARCOURIER el logotipo en sus versiones a
color, con fondo transparente, y el ícono LCE (`src/assets/marca/`).

Es un recurso provisional: Comunicación no entregó los archivos vectoriales y
el manual solo trae cada página como un JPEG de 150 ppp. La forma se toma del
logotipo grande de la página 4 del manual (negro sobre amarillo plano, ~710 px
de ancho); qué parte va en amarillo —la estela— se toma de la versión a color
de la página 10, más chica, escalada sobre la forma grande. El ícono sale de la
baldosa oscura de la página 7. Cuando lleguen los SVG oficiales, reemplazan a
estos PNG y este script sobra.

El manual no se versiona (es un documento interno y el repositorio es
público). Con Poppler y Pillow:

    pdfimages -f 1 -l 16 -j MANUAL.pdf <carpeta>/p
    ../backend/.venv/Scripts/python -I scripts/extraer-marca.py <carpeta> src/assets/marca
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ORIGEN = Path(sys.argv[1])
DESTINO = Path(sys.argv[2])
DESTINO.mkdir(parents=True, exist_ok=True)

AMARILLO = np.array([252, 226, 0], dtype=float)
NEGRO = np.array([0, 0, 0], dtype=float)
BLANCO = np.array([255, 255, 255], dtype=float)


def caja(mascara, umbral=0.25):
    ys, xs = np.where(mascara > umbral)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


# 1. Forma a buena resolución: logotipo negro sobre amarillo (página 4).
p4 = np.asarray(Image.open(ORIGEN / "p-008.jpg").convert("RGB"), dtype=float)
zona = p4[520:720, 930:1700]
fondo_g = np.median(zona[:8, :, 1])
tinta_g = np.percentile(zona[:, :, 1], 1)
alfa = np.clip((fondo_g - zona[:, :, 1]) / (fondo_g - tinta_g), 0, 1)
# El JPEG deja grano dentro de las letras y halo fuera: se estira el contraste
# para que el interior sea opaco y el fondo transparente, y solo el borde quede
# intermedio.
alfa = np.clip((alfa - 0.12) / 0.7, 0, 1)
x0, y0, x1, y1 = caja(alfa)
alfa = alfa[y0:y1, x0:x1]
alto, ancho = alfa.shape
print("forma", ancho, alto)

# 2. Qué es estela amarilla: versión negativa a color (página 10, fondo negro).
p10 = np.asarray(Image.open(ORIGEN / "p-015.jpg").convert("RGB"), dtype=float)
neg = p10[490 + 130 : 490 + 240, 877 + 480 : 877 + 840]
fondo = np.median(neg[:5, :, :].reshape(-1, 3), axis=0)
sin_fondo = np.clip(neg - fondo, 0, 255)
a_guia = sin_fondo.max(axis=2) / (255 - fondo.max())
gx0, gy0, gx1, gy1 = caja(a_guia, 0.3)
neg = sin_fondo[gy0:gy1, gx0:gx1]
a_guia = np.clip(a_guia[gy0:gy1, gx0:gx1], 1e-3, 1)
# Blanco tiene azul alto; amarillo, azul casi nulo.
amarillez = np.clip(1 - (neg[:, :, 2] / a_guia) / (255 - fondo[2]), 0, 1)
amarillez[a_guia < 0.15] = 0
guia = Image.fromarray((amarillez * 255).astype(np.uint8)).resize((ancho, alto), Image.LANCZOS)
amarillez = np.asarray(guia, dtype=float) / 255
amarillez = np.clip((amarillez - 0.35) / 0.3, 0, 1)  # bordes nítidos
# La guía escalada queda un poco más chica que la forma: se ensancha la estela
# unos píxeles para que su borde no quede con un filo negro.
from PIL import ImageFilter  # noqa: E402

amarillez = (
    np.asarray(
        Image.fromarray((amarillez * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)),
        dtype=float,
    )
    / 255
)


def version(tinta, nombre):
    color = amarillez[..., None] * AMARILLO + (1 - amarillez[..., None]) * tinta
    rgba = np.dstack([color, alfa * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    img.save(DESTINO / f"{nombre}.png", optimize=True)
    print(nombre, img.size)


version(NEGRO, "laarcourier-positivo")
version(BLANCO, "laarcourier-negativo")

# 3. Ícono LCE: la baldosa oscura de la página 7.
p7 = Image.open(ORIGEN / "p-011.jpg").convert("RGB")
baldosa = np.asarray(p7, dtype=float)[270 + 190 : 270 + 335, 1050 + 192 : 1050 + 338]
fondo = np.median(baldosa[60:70, 8:20].reshape(-1, 3), axis=0)
sin_fondo = np.clip(baldosa - fondo, 0, 255)
a = sin_fondo.max(axis=2) / (255 - fondo.max())
a = np.clip((a - 0.1) / 0.75, 0, 1)
# Recorta el dibujo dentro de la baldosa (sin las esquinas redondeadas).
interior = np.zeros_like(a)
interior[22:124, 6:141] = 1
a = a * interior
x0, y0, x1, y1 = caja(a, 0.3)
a = a[y0:y1, x0:x1]
s = sin_fondo[y0:y1, x0:x1]
amar = np.clip(1 - (s[:, :, 2] / np.clip(s.max(axis=2), 1, None)), 0, 1)
amar = np.clip((amar - 0.4) / 0.3, 0, 1)
color = amar[..., None] * AMARILLO + (1 - amar[..., None]) * BLANCO
glifo = Image.fromarray(np.dstack([color, a * 255]).astype(np.uint8), "RGBA")
glifo = glifo.resize((glifo.width * 4, glifo.height * 4), Image.LANCZOS)
glifo.save(DESTINO / "lce.png", optimize=True)
print("lce", glifo.size)
