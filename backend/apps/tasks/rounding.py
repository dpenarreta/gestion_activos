"""Redondeo «mitad hacia arriba», como `Math.round` de JavaScript.

Portado de Nexo (`apps.core.rounding`). `round()` de Python redondea al par en
los .5 (`round(2.5) == 2`); Nexo replicaba cálculos de su frontend y usaba
este redondeo en las horas reales y en los porcentajes de calidad del dato, así
que Tareas lo conserva para dar los mismos números."""

import math


def round_half_up(value: float, ndigits: int = 0) -> float | int:
    """`ndigits=0` devuelve `int` (como `Math.round(value)`); con `ndigits=n`,
    `float` (como `Math.round(value * 10**n) / 10**n`)."""
    factor = 10**ndigits
    result = math.floor(value * factor + 0.5) / factor
    return result if ndigits else int(result)
