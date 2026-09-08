"""Cálculo de contraste WCAG 2.1 entre pares de colores del tema.

La validación de *formato* hexadecimal es un rechazo duro (ver
`validators.py`); esta, en cambio, es una **advertencia**: un tema con
bajo contraste igual se guarda (es una elección estética válida en algunos
casos), pero el administrador debe verlo señalado explícitamente.
"""

AA_NORMAL_TEXT_THRESHOLD = 4.5


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def _channel_luminance(channel_255: int) -> float:
    channel = channel_255 / 255
    if channel <= 0.03928:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def _relative_luminance(hex_color: str) -> float:
    r, g, b = _hex_to_rgb(hex_color)
    return (
        0.2126 * _channel_luminance(r)
        + 0.7152 * _channel_luminance(g)
        + 0.0722 * _channel_luminance(b)
    )


def contrast_ratio(hex_a: str, hex_b: str) -> float:
    luminance_a = _relative_luminance(hex_a)
    luminance_b = _relative_luminance(hex_b)
    lighter, darker = max(luminance_a, luminance_b), min(luminance_a, luminance_b)
    return (lighter + 0.05) / (darker + 0.05)


def evaluate_theme_contrast(theme) -> list[dict]:
    """Evalúa los pares con significado real de un `SiteTheme`. Devuelve una
    entrada por par, con `passes=False` para los que no alcanzan el umbral
    AA de texto normal (4.5:1)."""
    pairs = [
        (
            "Texto principal sobre fondo",
            theme.color_text,
            theme.color_background,
            ["texto principal"],
        ),
        ("Encabezados sobre fondo", theme.color_headings, theme.color_background, ["encabezados"]),
        ("Enlaces sobre fondo", theme.color_links, theme.color_background, ["enlaces"]),
    ]
    results = []
    for label, foreground, background, elements in pairs:
        ratio = round(contrast_ratio(foreground, background), 2)
        results.append(
            {
                "pair": label,
                "foreground": foreground,
                "background": background,
                "ratio": ratio,
                "passes": ratio >= AA_NORMAL_TEXT_THRESHOLD,
                "elements_affected": elements,
            }
        )
    return results
