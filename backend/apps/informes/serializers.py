"""Validación de la entrada de los informes ejecutivos.

El pedido de generación tiene la forma de `ExecutiveReportFilters` de Nexo
(un período discriminado por tipo, una fecha de corte opcional y tres filtros
que solo acotan), con los nombres en español y en el cuerpo JSON (en Nexo iba
en la query string). Los límites son los de Nexo: un rango de meses de 2 a 24
meses; un rango personalizado de hasta 366 días.
"""

import re
from datetime import UTC, date, datetime

from django.utils import timezone
from rest_framework import serializers

from apps.tasks.business_time import business_calendar_day
from apps.tasks.roles import ALL_ROLES

from .member_kpis import months_in_range
from .models import ExecutiveReportSnapshot
from .services import Pedido

_MES = re.compile(r"^(\d{4})-(\d{2})$")
_DIA = re.compile(r"^\d{4}-\d{2}-\d{2}$")

MAX_DIAS_RANGO = 366
MIN_MESES_RANGO, MAX_MESES_RANGO = 2, 24


def parse_mes(valor: str, campo: str) -> tuple[int, int]:
    coincidencia = _MES.match(valor or "")
    if not coincidencia:
        raise serializers.ValidationError(
            {campo: ["Use el formato AAAA-MM (por ejemplo, 2026-10)."]}
        )
    year, month = int(coincidencia.group(1)), int(coincidencia.group(2))
    if not 1 <= month <= 12 or not 2000 <= year <= 2100:
        raise serializers.ValidationError({campo: ["El mes no es válido."]})
    return year, month


def parse_dia(valor: str, campo: str) -> date:
    if not _DIA.match(valor or ""):
        raise serializers.ValidationError(
            {campo: ["Use el formato AAAA-MM-DD (por ejemplo, 2026-10-31)."]}
        )
    try:
        dia = date.fromisoformat(valor)
    except ValueError as exc:
        raise serializers.ValidationError({campo: ["La fecha no es válida."]}) from exc
    if not 2000 <= dia.year <= 2100:
        raise serializers.ValidationError({campo: ["La fecha no es válida."]})
    return dia


class GenerarInformeSerializer(serializers.Serializer):
    """`POST executive/`."""

    tipo = serializers.ChoiceField(
        choices=ExecutiveReportSnapshot.Type.choices,
        error_messages={"invalid_choice": "Elija MENSUAL, RANGO_MESES o RANGO_PERSONALIZADO."},
    )
    #: MENSUAL: «AAAA-MM».
    mes = serializers.CharField(required=False, allow_blank=False, max_length=7)
    #: RANGO_MESES: «AAAA-MM»; RANGO_PERSONALIZADO: «AAAA-MM-DD».
    desde = serializers.CharField(required=False, allow_blank=False, max_length=10)
    hasta = serializers.CharField(required=False, allow_blank=False, max_length=10)
    #: Instante ISO-8601 hasta el que cuenta la información. Si falta, el corte
    #: del cierre de mes o el fin del período (nunca después de ahora).
    fecha_corte = serializers.DateTimeField(required=False, allow_null=True)
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ALL_ROLES),
        required=False,
        default=list,
        max_length=len(ALL_ROLES),
    )
    #: Ids de unidades del organigrama.
    areas = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=200
    )
    #: Ids de cuentas.
    colaboradores = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=500
    )

    def _requerido(self, attrs, campo):
        if not attrs.get(campo):
            raise serializers.ValidationError(
                {campo: ["Este campo es obligatorio para este tipo."]}
            )
        return attrs[campo]

    def validate(self, attrs):
        tipo = attrs["tipo"]
        ahora = timezone.now()
        hoy = business_calendar_day(ahora)
        actual = (hoy.year, hoy.month)

        if tipo == ExecutiveReportSnapshot.Type.MENSUAL:
            periodo = parse_mes(self._requerido(attrs, "mes"), "mes")
            if periodo > actual:
                raise serializers.ValidationError({"mes": ["Ese mes todavía no empieza."]})
            inicio = datetime(periodo[0], periodo[1], 1, tzinfo=UTC)
        elif tipo == ExecutiveReportSnapshot.Type.RANGO_MESES:
            desde = parse_mes(self._requerido(attrs, "desde"), "desde")
            hasta = parse_mes(self._requerido(attrs, "hasta"), "hasta")
            if desde >= hasta:
                raise serializers.ValidationError(
                    {"desde": ["El mes de inicio debe ser anterior al de fin."]}
                )
            if hasta > actual:
                raise serializers.ValidationError({"hasta": ["Ese mes todavía no empieza."]})
            meses = len(months_in_range(*desde, *hasta))
            if not MIN_MESES_RANGO <= meses <= MAX_MESES_RANGO:
                raise serializers.ValidationError(
                    {"hasta": [f"El rango debe tener entre 2 y {MAX_MESES_RANGO} meses."]}
                )
            periodo = (desde, hasta)
            inicio = datetime(desde[0], desde[1], 1, tzinfo=UTC)
        else:
            desde = parse_dia(self._requerido(attrs, "desde"), "desde")
            hasta = parse_dia(self._requerido(attrs, "hasta"), "hasta")
            if desde > hasta:
                raise serializers.ValidationError(
                    {"desde": ["La fecha de inicio debe ser anterior o igual a la de fin."]}
                )
            if (hasta - desde).days > MAX_DIAS_RANGO:
                raise serializers.ValidationError(
                    {"hasta": [f"El rango no puede superar {MAX_DIAS_RANGO} días."]}
                )
            if desde > hoy:
                raise serializers.ValidationError({"desde": ["Ese día todavía no llega."]})
            periodo = (desde, hasta)
            inicio = datetime(desde.year, desde.month, desde.day, tzinfo=UTC)

        fecha_corte = attrs.get("fecha_corte")
        if fecha_corte is not None and fecha_corte < inicio:
            raise serializers.ValidationError(
                {"fecha_corte": ["La fecha de corte no puede ser anterior al inicio del período."]}
            )

        attrs["pedido"] = Pedido(
            tipo=tipo,
            periodo=periodo,
            fecha_corte=fecha_corte,
            roles=tuple(dict.fromkeys(attrs.get("roles") or [])),
            areas=tuple(dict.fromkeys(attrs.get("areas") or [])),
            colaboradores=tuple(dict.fromkeys(attrs.get("colaboradores") or [])),
        )
        return attrs


class RosterQuerySerializer(serializers.Serializer):
    """`GET roster/?roles=<csv>&areas=<csv>&colaboradores=<csv>`."""

    roles = serializers.CharField(required=False, allow_blank=True, max_length=500)
    areas = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    colaboradores = serializers.CharField(required=False, allow_blank=True, max_length=5000)

    def validate_roles(self, valor):
        roles = [v.strip() for v in (valor or "").split(",") if v.strip()]
        invalidos = [r for r in roles if r not in ALL_ROLES]
        if invalidos:
            raise serializers.ValidationError(f"Rol desconocido: {', '.join(invalidos[:3])}.")
        return roles

    def _ids(self, valor):
        partes = [v.strip() for v in (valor or "").split(",") if v.strip()]
        if any(not p.isdigit() for p in partes):
            raise serializers.ValidationError("Use ids numéricos separados por coma.")
        return [int(p) for p in partes]

    def validate_areas(self, valor):
        return self._ids(valor)

    def validate_colaboradores(self, valor):
        return self._ids(valor)


class ClosureStatusQuerySerializer(serializers.Serializer):
    """`GET executive/closure-status/?year=&month=`."""

    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)


class ListadoQuerySerializer(serializers.Serializer):
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    page_size = serializers.IntegerField(required=False, min_value=1, max_value=100, default=20)
    tipo = serializers.ChoiceField(
        choices=ExecutiveReportSnapshot.Type.choices, required=False, allow_blank=True
    )
    estado = serializers.ChoiceField(
        choices=ExecutiveReportSnapshot.PeriodStatus.choices, required=False, allow_blank=True
    )


class EventoSerializer(serializers.Serializer):
    """`POST executive/<report_id>/eventos/`: lo único que el navegador puede
    anotar en la bitácora es que imprimió el PDF (el resto lo registra el
    servidor)."""

    action = serializers.ChoiceField(choices=["exported_pdf"])
