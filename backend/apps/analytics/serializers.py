"""Validación de entrada del motor de KPI.

Las del simulador de Inteligencia Preventiva y las de los ajustes son réplica
de Nexo (`apps.analytics.serializers` y `apps.configuration.serializers`).
Las de los parámetros de consulta (`month`, `from`/`to`) son nuevas: en Nexo
un `month` malformado reventaba con 500; aquí es un 400 del contrato.
"""

import re

from rest_framework import serializers

from apps.tasks.roles import ALL_ROLES

from .configuracion import PREDICTION_WINDOW_OPTIONS

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_MONTH_ERROR = "Debe tener el formato AAAA-MM (por ejemplo, 2026-08)."


def parse_month(value: str) -> tuple[int, int]:
    match = _MONTH_RE.match(value or "")
    if not match:
        raise serializers.ValidationError(_MONTH_ERROR)
    return int(match.group(1)), int(match.group(2))


class MonthQuerySerializer(serializers.Serializer):
    """`?month=YYYY-MM` opcional (KPI de un mes)."""

    month = serializers.CharField(required=False, allow_blank=False, max_length=7)

    def validate_month(self, value: str) -> str:
        parse_month(value)
        return value


class RangeQuerySerializer(serializers.Serializer):
    """`?from=YYYY-MM&to=YYYY-MM` del reporte por rango (las reglas de 2 a 24
    meses son las de Nexo y las aplica la vista)."""

    default_error_messages = {"required": "Parámetros from y to requeridos"}

    def to_internal_value(self, data):
        from_str, to_str = data.get("from"), data.get("to")
        if not from_str or not to_str:
            raise serializers.ValidationError({"from": ["Parámetros from y to requeridos"]})
        errores = {}
        for campo, valor in (("from", from_str), ("to", to_str)):
            try:
                parse_month(valor)
            except serializers.ValidationError as exc:
                errores[campo] = exc.detail
        if errores:
            raise serializers.ValidationError(errores)
        return {"from": from_str, "to": to_str}


class AdjustTargetTimeSimulationSerializer(serializers.Serializer):
    """`newTargetTimeHours` en [0, 1000] (réplica de Nexo)."""

    task_id = serializers.IntegerField(min_value=1)
    new_target_time_hours = serializers.FloatField(min_value=0, max_value=1000)


class AddParticipantsSimulationSerializer(serializers.Serializer):
    """`additionalParticipants` en (0, 20] (réplica de Nexo)."""

    additional_participants = serializers.FloatField(max_value=20)

    def validate_additional_participants(self, value: float) -> float:
        if value <= 0:
            raise serializers.ValidationError("Debe ser mayor a 0.")
        return value


class RedistributeLoadSimulationSerializer(serializers.Serializer):
    """`hours` en (0, 200], `from_user_id` != `to_user_id` (réplica de Nexo)."""

    from_user_id = serializers.IntegerField(min_value=1)
    to_user_id = serializers.IntegerField(min_value=1)
    hours = serializers.FloatField(max_value=200)

    def validate_hours(self, value: float) -> float:
        if value <= 0:
            raise serializers.ValidationError("Debe ser mayor a 0.")
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs["from_user_id"] == attrs["to_user_id"]:
            raise serializers.ValidationError(
                {"to_user_id": ["from_user_id y to_user_id deben ser distintos."]}
            )
        return attrs


# ── Ajustes del motor ───────────────────────────────────────────────────────


class PredictionWindowUpdateSerializer(serializers.Serializer):
    window_weeks = serializers.ChoiceField(choices=PREDICTION_WINDOW_OPTIONS)


class RoleTargetFieldsSerializer(serializers.Serializer):
    """Cada campo es `null` o un número en [0, 100]: nunca un objetivo
    inventado."""

    performance = serializers.FloatField(min_value=0, max_value=100, allow_null=True)
    riesgo_max = serializers.FloatField(min_value=0, max_value=100, allow_null=True)
    cumplimiento = serializers.FloatField(min_value=0, max_value=100, allow_null=True)


class RoleTargetUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=ALL_ROLES)
    target = RoleTargetFieldsSerializer()


class RoleCompatibilityUpdateSerializer(serializers.Serializer):
    """La Regla 4 (nunca entre niveles distintos) la valida el servicio."""

    role = serializers.ChoiceField(choices=ALL_ROLES)
    compatible_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ALL_ROLES), max_length=len(ALL_ROLES)
    )


class CurveUpdateSerializer(serializers.Serializer):
    """`points` se valida con `normalization.is_valid_curve` en el servicio
    (lista dinámica de `{x, y}`)."""

    name = serializers.CharField(max_length=30)
    points = serializers.JSONField()


class KpiStartDateUpdateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    kpi_start_date = serializers.DateField(required=False, allow_null=True)
