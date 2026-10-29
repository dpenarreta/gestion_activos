"""Validaciones del tema visual del sistema."""

import re

from rest_framework import serializers

from .catalog import is_valid_border_radius, is_valid_font

HEX_COLOR_PATTERN = re.compile(r"^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")

COLOR_FIELDS = [
    "color_primary",
    "color_secondary",
    "color_background",
    "color_headings",
    "color_text",
    "color_links",
    "color_buttons",
    "color_menu",
]

FONT_SIZE_MIN = 12
FONT_SIZE_MAX = 24


def validate_hex_color(value: str) -> str:
    if not HEX_COLOR_PATTERN.match(value):
        raise serializers.ValidationError(
            f"'{value}' no es un color hexadecimal válido (ej. #0D6EFD o #0d6)."
        )
    return value


def validate_font_slug(value: str) -> str:
    if not is_valid_font(value):
        raise serializers.ValidationError(f"Fuente inexistente en el catálogo: {value}.")
    return value


def validate_border_radius_slug(value: str) -> str:
    if not is_valid_border_radius(value):
        raise serializers.ValidationError(f"Radio de borde inexistente en el catálogo: {value}.")
    return value


def validate_imagen_url(value: str) -> str:
    """`logo_url`/`favicon_url`: una ruta del propio sitio (`/static/logo.png`)
    o una dirección `https://`. Nada más.

    Auditoría de seguridad, 29/10/2026: el campo aceptaba cualquier texto, y
    termina en el `src` del logo y en el `href` del favicon de todas las
    pantallas, incluida la de inicio de sesión (sin autenticar). `javascript:`,
    `data:` o un `http://` (contenido mixto en un sitio servido por HTTPS) no
    tienen uso legítimo aquí: no hay ninguna configuración que los use, ni en
    local. `//otro.sitio` se rechaza porque, pese a empezar por «/», apunta
    fuera del sitio.
    """
    texto = (value or "").strip()
    if not texto:
        return ""
    if any(ord(c) < 33 for c in texto):
        raise serializers.ValidationError(
            "La dirección no puede tener espacios ni saltos de línea."
        )
    es_ruta_propia = texto.startswith("/") and not texto.startswith(("//", "/\\"))
    if not (es_ruta_propia or texto.lower().startswith("https://")):
        raise serializers.ValidationError(
            "Use una ruta del sitio que empiece por «/» o una dirección que empiece por «https://»."
        )
    return texto


def validate_font_size(value: int) -> int:
    if not FONT_SIZE_MIN <= value <= FONT_SIZE_MAX:
        raise serializers.ValidationError(
            f"El tamaño base de fuente debe estar entre {FONT_SIZE_MIN} y {FONT_SIZE_MAX} px."
        )
    return value
