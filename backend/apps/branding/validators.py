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


def validate_font_size(value: int) -> int:
    if not FONT_SIZE_MIN <= value <= FONT_SIZE_MAX:
        raise serializers.ValidationError(
            f"El tamaño base de fuente debe estar entre {FONT_SIZE_MIN} y {FONT_SIZE_MAX} px."
        )
    return value
