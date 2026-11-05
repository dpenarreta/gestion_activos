"""Entradas de las ausencias (las validaciones de Nexo, con rangos y
longitudes coherentes con el modelo). Las salidas las arma
`services.serialize_*`, con las claves en camelCase de Nexo."""

from rest_framework import serializers

from .models import LeaveRecord, SpecialStatus

OBSERVATION_MAX = 1000


class LeaveRecordCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    type = serializers.ChoiceField(choices=LeaveRecord.Type.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    is_full_day = serializers.BooleanField()
    duration_minutes = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=1440
    )
    observation = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=OBSERVATION_MAX
    )

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError(
                {"end_date": ["La fecha fin debe ser igual o posterior a la fecha inicio"]}
            )
        if attrs["type"] == LeaveRecord.Type.VACACIONES and not attrs["is_full_day"]:
            raise serializers.ValidationError(
                {"is_full_day": ["Las vacaciones siempre son de día completo"]}
            )
        if not attrs["is_full_day"] and attrs.get("duration_minutes") is None:
            raise serializers.ValidationError(
                {"duration_minutes": ["La duración debe ser un número de minutos entre 1 y 1440"]}
            )
        return attrs


class LeaveRecordQuerySerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False, min_value=1)
    month = serializers.RegexField(r"^\d{4}-\d{2}$", required=False)
    type = serializers.ChoiceField(choices=LeaveRecord.Type.choices, required=False)


class SpecialStatusCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    type = serializers.ChoiceField(choices=SpecialStatus.Type.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False, allow_null=True)
    daily_hours = serializers.FloatField()
    limit_low = serializers.FloatField()
    limit_base = serializers.FloatField()
    limit_high = serializers.FloatField()
    limit_overload = serializers.FloatField()

    def _validate_hours_field(self, value, label):
        if value <= 0 or value > 24:
            raise serializers.ValidationError(
                f"El campo {label} debe ser un número entre 0 y 24 horas"
            )
        return value

    def validate_daily_hours(self, value):
        return self._validate_hours_field(value, "horas diarias")

    def validate_limit_low(self, value):
        return self._validate_hours_field(value, "límite de subutilización")

    def validate_limit_base(self, value):
        return self._validate_hours_field(value, "límite moderado/óptimo")

    def validate_limit_high(self, value):
        return self._validate_hours_field(value, "límite óptimo/elevada")

    def validate_limit_overload(self, value):
        return self._validate_hours_field(value, "límite de sobrecarga")

    def validate(self, attrs):
        if attrs.get("end_date") and attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError(
                {"end_date": ["La fecha fin debe ser igual o posterior a la fecha inicio"]}
            )
        if not (
            attrs["limit_low"]
            < attrs["limit_base"]
            <= attrs["limit_high"]
            < attrs["limit_overload"]
        ):
            raise serializers.ValidationError(
                {
                    "limit_base": [
                        "Los límites deben cumplir: Subutilización < Moderado/Óptimo ≤ "
                        "Óptimo/Elevada < Elevada/Sobrecarga"
                    ]
                }
            )
        return attrs
