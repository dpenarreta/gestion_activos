"""Catálogo cerrado de fuentes y radios de borde permitidos para el tema.

Deliberadamente una lista estática de fuentes web-safe/del sistema (sin
dependencia de red ni de la Biblioteca multimedia del proyecto original,
que esta base no incluye) — un proyecto concreto que necesite un
catálogo más amplio o tipografías vía CDN puede reemplazar este archivo sin
tocar el resto del módulo (ver docs/roles-and-permissions.md /
docs/architecture.md).
"""

FONT_FAMILIES = {
    "system-ui": {
        "label": "Predeterminada del sistema",
        "css_stack": "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    "arial": {"label": "Arial", "css_stack": "Arial, Helvetica, sans-serif"},
    "helvetica": {"label": "Helvetica", "css_stack": "Helvetica, Arial, sans-serif"},
    "verdana": {"label": "Verdana", "css_stack": "Verdana, Geneva, sans-serif"},
    "tahoma": {"label": "Tahoma", "css_stack": "Tahoma, Geneva, sans-serif"},
    "segoe-ui": {"label": "Segoe UI", "css_stack": "'Segoe UI', Tahoma, Geneva, sans-serif"},
    "georgia": {"label": "Georgia", "css_stack": "Georgia, 'Times New Roman', serif"},
    "times-new-roman": {
        "label": "Times New Roman",
        "css_stack": "'Times New Roman', Times, serif",
    },
    "courier-new": {"label": "Courier New", "css_stack": "'Courier New', Courier, monospace"},
    "inter": {
        "label": "Inter (si está instalada localmente)",
        "css_stack": "Inter, system-ui, -apple-system, sans-serif",
    },
    # Las dos de la identidad base. No dependen de la red: el frontend las
    # trae empaquetadas (`@fontsource`), así que la CSP `font-src 'self'` las
    # deja cargar.
    "ibm-plex-sans": {
        "label": "IBM Plex Sans (identidad base)",
        "css_stack": "'IBM Plex Sans', system-ui, sans-serif",
    },
    "sora": {
        "label": "Sora (identidad base)",
        "css_stack": "Sora, system-ui, sans-serif",
    },
}

ALLOWED_BORDER_RADII = {
    "none": {"label": "Sin bordes redondeados", "value": "0"},
    "sm": {"label": "Pequeño", "value": "0.25rem"},
    "base": {"label": "Identidad base (6px)", "value": "6px"},
    "md": {"label": "Medio", "value": "0.5rem"},
    "lg": {"label": "Grande", "value": "1rem"},
    "pill": {"label": "Píldora", "value": "50rem"},
}

# Identidad visual por defecto de este sistema — fuente única de verdad
# para la migración de siembra y para "restaurar valores por defecto".
DEFAULT_THEME = {
    "site_name": "Gestión de Activos",
    "short_name": "Activos",
    "logo_url": "",
    "favicon_url": "",
    "color_primary": "#1C5DA3",
    "color_secondary": "#164B86",
    "color_background": "#F2F4F8",
    "color_headings": "#0F2138",
    "color_text": "#0F2138",
    "color_links": "#1C5DA3",
    "color_buttons": "#0D6EFD",
    "color_menu": "#0A1E38",
    "font_primary": "ibm-plex-sans",
    "font_secondary": "sora",
    "font_size_base": 14,
    "border_radius": "base",
}


def is_valid_font(slug: str) -> bool:
    return slug in FONT_FAMILIES


def is_valid_border_radius(slug: str) -> bool:
    return slug in ALLOWED_BORDER_RADII


def css_stack_for(slug: str) -> str:
    font = FONT_FAMILIES.get(slug)
    if font is None:
        return "system-ui, -apple-system, sans-serif"
    return font["css_stack"]
