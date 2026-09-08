from rest_framework import serializers

from .catalog import ALLOWED_BORDER_RADII, css_stack_for
from .models import SiteTheme
from .validators import (
    validate_border_radius_slug,
    validate_font_size,
    validate_font_slug,
    validate_hex_color,
)


class SiteThemeSerializer(serializers.ModelSerializer):
    """Valida cada campo contra `validators.py` — un color con formato
    inválido se rechaza aquí, antes de tocar la fila vigente (a diferencia
    del contraste insuficiente, que es una advertencia posterior al
    guardar, no un rechazo).

    Incluye los stacks CSS ya resueltos (`font_primary_css`, etc.) para que
    el frontend nunca tenga que mantener su propia copia del catálogo de
    fuentes/radios solo para *aplicar* el tema — solo la necesita para
    construir el selector, y eso lo trae `ThemeOptionsView` aparte.
    """

    font_primary_css = serializers.SerializerMethodField()
    font_secondary_css = serializers.SerializerMethodField()
    border_radius_css = serializers.SerializerMethodField()

    class Meta:
        model = SiteTheme
        fields = [
            "id",
            "site_name",
            "short_name",
            "logo_url",
            "favicon_url",
            "color_primary",
            "color_secondary",
            "color_background",
            "color_headings",
            "color_text",
            "color_links",
            "color_buttons",
            "color_menu",
            "font_primary",
            "font_secondary",
            "font_primary_css",
            "font_secondary_css",
            "font_size_base",
            "border_radius",
            "border_radius_css",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "updated_at",
            "font_primary_css",
            "font_secondary_css",
            "border_radius_css",
        ]

    def get_font_primary_css(self, obj: SiteTheme) -> str:
        return css_stack_for(obj.font_primary)

    def get_font_secondary_css(self, obj: SiteTheme) -> str:
        return css_stack_for(obj.font_secondary)

    def get_border_radius_css(self, obj: SiteTheme) -> str:
        return ALLOWED_BORDER_RADII[obj.border_radius]["value"]

    def validate_color_primary(self, value):
        return validate_hex_color(value)

    def validate_color_secondary(self, value):
        return validate_hex_color(value)

    def validate_color_background(self, value):
        return validate_hex_color(value)

    def validate_color_headings(self, value):
        return validate_hex_color(value)

    def validate_color_text(self, value):
        return validate_hex_color(value)

    def validate_color_links(self, value):
        return validate_hex_color(value)

    def validate_color_buttons(self, value):
        return validate_hex_color(value)

    def validate_color_menu(self, value):
        return validate_hex_color(value)

    def validate_font_primary(self, value):
        return validate_font_slug(value)

    def validate_font_secondary(self, value):
        return validate_font_slug(value)

    def validate_border_radius(self, value):
        return validate_border_radius_slug(value)

    def validate_font_size_base(self, value):
        return validate_font_size(value)
