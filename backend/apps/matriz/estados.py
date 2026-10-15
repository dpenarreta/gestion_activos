"""El estado de un período, calculado y nunca guardado (§9).

Guardarlo obligaría a un proceso que lo actualice a medianoche, y entre su
última pasada y la siguiente el sistema diría «en progreso» de algo que ya
venció. Calculado en cada consulta, un período pasa a Incumplido justo después
de su hora de vencimiento —en la zona horaria de **su empresa**, no en la del
servidor—.

Las reglas se evalúan en este orden:

1. Cerrado y cumplido a tiempo → Finalizado.
2. Cerrado y cumplido tarde → «Finalizada fuera de plazo».
3. Abierto y vencido → Incumplido.
4. Abierto y vence hoy → «Vence hoy» (una marca, **no** una etapa: un período
   pendiente de validación sigue pendiente el día del vencimiento).
5. Abierto, dentro del plazo → la etapa.
"""

import math
import zoneinfo

from django.db.models import Q
from django.utils import timezone

from .models import Etapa

INCUMPLIDO = "incumplido"
EN_PROGRESO = "en_progreso"
FINALIZADO = "finalizado"

ETIQUETA_GRUPO = {
    INCUMPLIDO: "Incumplido",
    EN_PROGRESO: "En progreso",
    FINALIZADO: "Finalizado",
}

#: Orden por urgencia (§9): primero lo incumplido, después lo que corre, al
#: final lo cerrado.
ORDEN_GRUPO = {INCUMPLIDO: 0, EN_PROGRESO: 1, FINALIZADO: 2}

_SEGUNDOS_POR_DIA = 86400


def zona_de(empresa) -> zoneinfo.ZoneInfo:
    try:
        return zoneinfo.ZoneInfo(empresa.zona_horaria)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError, AttributeError):
        return zoneinfo.ZoneInfo("America/Guayaquil")


def _dias_hacia_arriba(desde, hasta) -> int:
    """Días entre dos instantes, redondeando hacia arriba, mínimo 1."""
    segundos = (hasta - desde).total_seconds()
    return max(1, math.ceil(segundos / _SEGUNDOS_POR_DIA))


def estado(periodo, ahora=None) -> dict:
    """El objeto de estado de la API (§9) para un período."""
    ahora = ahora or timezone.now()
    zona = zona_de(periodo.empresa)
    vence = periodo.vence_en
    base = {
        "stage": periodo.etapa,
        "is_due_today": False,
        "is_late": False,
        "days_overdue": 0,
        "days_remaining": None,
    }

    if periodo.cerrado:
        cumplimiento = periodo.cumplido_en or periodo.validado_en or ahora
        if cumplimiento <= vence:
            return {
                **base,
                "group": FINALIZADO,
                "group_label": ETIQUETA_GRUPO[FINALIZADO],
                "label": "Finalizado",
            }
        return {
            **base,
            "group": FINALIZADO,
            "group_label": ETIQUETA_GRUPO[FINALIZADO],
            "label": "Finalizada fuera de plazo",
            "is_late": True,
            "days_overdue": _dias_hacia_arriba(vence, cumplimiento),
        }

    if ahora > vence:
        return {
            **base,
            "group": INCUMPLIDO,
            "group_label": ETIQUETA_GRUPO[INCUMPLIDO],
            "label": "Incumplido",
            "days_overdue": _dias_hacia_arriba(vence, ahora),
        }

    hoy = ahora.astimezone(zona).date()
    dia_vence = vence.astimezone(zona).date()
    if hoy == dia_vence:
        return {
            **base,
            "group": EN_PROGRESO,
            "group_label": ETIQUETA_GRUPO[EN_PROGRESO],
            "label": "Vence hoy",
            "is_due_today": True,
            "days_remaining": 0,
        }

    return {
        **base,
        "group": EN_PROGRESO,
        "group_label": ETIQUETA_GRUPO[EN_PROGRESO],
        "label": Etapa(periodo.etapa).label,
        "days_remaining": (dia_vence - hoy).days,
    }


def filtro_de_grupo(grupo: str, ahora=None) -> Q:
    """El equivalente en base de datos de cada grupo (§9), para no traer todos
    los períodos a memoria al filtrar la matriz."""
    ahora = ahora or timezone.now()
    if grupo == FINALIZADO:
        return Q(cerrado=True)
    if grupo == INCUMPLIDO:
        return Q(cerrado=False, vence_en__lt=ahora)
    if grupo == EN_PROGRESO:
        return Q(cerrado=False, vence_en__gte=ahora)
    return Q()
