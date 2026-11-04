"""Ajustes del módulo con vigencia (sustituto de los servicios de
`apps.configuration` de Nexo que usaba Novedades).

Mismo comportamiento: el valor que rige un cálculo es el vigente en un
instante dado, nunca uno posterior, así que un cambio no altera plazos que ya
empezaron. Los ajustes son por empresa (`SettingHistory` hereda de
`ModeloDeEmpresa`).
"""

from datetime import datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import SettingHistory


def get_effective_config_value(key: str, as_of: datetime, fallback: float) -> float:
    """Valor numérico de `key` vigente en `as_of`, o `fallback` si no hay o no
    es un número válido."""
    record = (
        SettingHistory.objects.filter(key=key, valid_from__lte=as_of)
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=as_of))
        .order_by("-valid_from")
        .first()
    )
    if record is None:
        return fallback
    try:
        value = float(record.value)
    except ValueError:
        return fallback
    if value != value or value in (float("inf"), float("-inf")):  # NaN/Inf
        return fallback
    return value


def current_record(key: str) -> SettingHistory | None:
    """El registro vigente de `key` (para mostrar quién y cuándo lo cambió)."""
    return (
        SettingHistory.objects.filter(key=key, valid_until__isnull=True)
        .select_related("updated_by")
        .order_by("-valid_from")
        .first()
    )


def set_config_value(key: str, value: str, actor) -> None:
    """Cierra el registro vigente (si hay) y abre uno nuevo desde ahora."""
    now = timezone.now()
    with transaction.atomic():
        SettingHistory.objects.filter(key=key, valid_until__isnull=True).update(valid_until=now)
        SettingHistory.objects.create(key=key, value=value, valid_from=now, updated_by=actor)
