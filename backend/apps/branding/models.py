from django.db import models

from apps.core.models import BaseModel

from .catalog import DEFAULT_THEME


class SiteTheme(BaseModel):
    """Identidad institucional y tema visual — configuración *singleton*: una
    única fila activa (bootstrapeada por una migración de datos). Se
    administra vía `/api/v1/admin/theme/` (permiso `configuracion.editar`) y
    se consulta sin autenticación en `/api/v1/theme/current/`, porque el
    login/registro también deben pintarse con la marca configurada.

    `logo_url`/`favicon_url` son URLs de texto, no un pipeline de carga de
    archivos — decisión deliberada para mantener esta base
    desacoplado de cualquier biblioteca de medios (ver docs/architecture.md).
    """

    site_name = models.CharField(max_length=150, default=DEFAULT_THEME["site_name"])
    short_name = models.CharField(max_length=50, default=DEFAULT_THEME["short_name"])
    logo_url = models.CharField(max_length=500, blank=True, default=DEFAULT_THEME["logo_url"])
    favicon_url = models.CharField(max_length=500, blank=True, default=DEFAULT_THEME["favicon_url"])
    color_primary = models.CharField(max_length=7, default=DEFAULT_THEME["color_primary"])
    color_secondary = models.CharField(max_length=7, default=DEFAULT_THEME["color_secondary"])
    color_background = models.CharField(max_length=7, default=DEFAULT_THEME["color_background"])
    color_headings = models.CharField(max_length=7, default=DEFAULT_THEME["color_headings"])
    color_text = models.CharField(max_length=7, default=DEFAULT_THEME["color_text"])
    color_links = models.CharField(max_length=7, default=DEFAULT_THEME["color_links"])
    color_buttons = models.CharField(max_length=7, default=DEFAULT_THEME["color_buttons"])
    color_menu = models.CharField(max_length=7, default=DEFAULT_THEME["color_menu"])
    font_primary = models.CharField(max_length=50, default=DEFAULT_THEME["font_primary"])
    font_secondary = models.CharField(max_length=50, default=DEFAULT_THEME["font_secondary"])
    font_size_base = models.PositiveSmallIntegerField(default=DEFAULT_THEME["font_size_base"])
    border_radius = models.CharField(max_length=20, default=DEFAULT_THEME["border_radius"])

    def __str__(self) -> str:
        return self.site_name
