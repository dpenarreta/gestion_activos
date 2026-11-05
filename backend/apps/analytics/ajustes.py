"""Ajustes del motor de KPI y fecha de inicio del KPI de cada persona.

Réplica de los endpoints de Nexo que configuraban el motor
(`apps.configuration.views`: `analytics-config`, `workload-config`,
`prediction-window`, `normalization-curves`, `role-targets`,
`role-compatibility` y `kpi-start-date`), con sus mismas validaciones y las
mismas claves en `SettingHistory`. Leerlos exige `kpi.acceder`; cambiarlos,
`kpi.administrar` (en Nexo, el ADMINISTRADOR o `can_manage_users`). Cada
cambio queda en la auditoría de la intranet.

Las horas efectivas del día y las horas esperadas del mes son de Tareas
(`apps.tasks.configuracion`, sus ajustes): aquí solo se leen para validar el
orden de los límites del semáforo.
"""

import json
from datetime import datetime
from datetime import timezone as dt_timezone

from django.db import transaction
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.tasks.roles import ALL_ROLES, ROLE_LABEL, ROLE_LEVEL, gh_role_of
from apps.tasks.rounding import round_half_up

from . import configuracion as conf
from .errores import AnalyticsError
from .models import KpiStartDate
from .normalization import (
    DEFAULT_CURVES,
    get_all_effective_curves,
    is_valid_curve,
    set_curve_config,
)
from .prediction import PREDICTION_MAX_DAYS

AUDIT_MODULE = "kpi"

ANALYTICS_CONFIG_VALIDATION: dict[str, tuple[float, float]] = {
    "health_weight_cumplimiento": (0, 100),
    "health_weight_carga": (0, 100),
    "health_weight_vencidas": (0, 100),
    "health_weight_consistencia": (0, 100),
    "health_weight_capacidad": (0, 100),
    "perf_weight_cumplimiento": (0, 100),
    "perf_weight_vencidas": (0, 100),
    "perf_weight_consistencia": (0, 100),
    "perf_weight_trazabilidad": (0, 100),
    "risk_weight_sobrecarga": (0, 100),
    "risk_weight_vencidas_criticas": (0, 100),
    "risk_weight_tendencia_negativa": (0, 100),
    "risk_weight_horas_extra": (0, 100),
    "risk_weight_baja_capacidad": (0, 100),
    "risk_weight_variabilidad": (0, 100),
    "risk_weight_concentracion": (0, 100),
    "risk_weight_sin_planificacion": (0, 100),
    "risk_threshold_medio": (1, 99),
    "risk_threshold_alto": (1, 99),
    "risk_threshold_critico": (1, 100),
    "alert_overdue_task_threshold": (1, 50),
    "alert_consecutive_overload_days": (1, 30),
    "anomaly_variation_threshold_pct": (5, 200),
    "cache_ttl_minutes": (1, 1440),
    "prediction_min_weeks_media": (1, 10),
    "prediction_min_weeks_alta": (1, 20),
}

HEALTH_WEIGHT_KEYS = (
    "health_weight_cumplimiento",
    "health_weight_carga",
    "health_weight_vencidas",
    "health_weight_consistencia",
    "health_weight_capacidad",
)
PERF_WEIGHT_KEYS = (
    "perf_weight_cumplimiento",
    "perf_weight_vencidas",
    "perf_weight_consistencia",
    "perf_weight_trazabilidad",
)
RISK_WEIGHT_KEYS = (
    "risk_weight_sobrecarga",
    "risk_weight_vencidas_criticas",
    "risk_weight_tendencia_negativa",
    "risk_weight_horas_extra",
    "risk_weight_baja_capacidad",
    "risk_weight_variabilidad",
    "risk_weight_concentracion",
    "risk_weight_sin_planificacion",
)

#: Los 3 límites por día del semáforo (los de Nexo `workload-config`, sin las
#: horas efectivas ni las esperadas del mes, que se ajustan en Tareas).
WORKLOAD_LIMIT_FIELDS: dict[str, tuple] = {
    "workload_limit_low": (
        conf.get_effective_workload_limit_low,
        conf.CONFIG_KEY_WORKLOAD_LIMIT_LOW,
        0,
        24,
        "El límite de Subutilización",
    ),
    "workload_limit_high": (
        conf.get_effective_workload_limit_high,
        conf.CONFIG_KEY_WORKLOAD_LIMIT_HIGH,
        0,
        24,
        "El límite superior óptimo",
    ),
    "workload_limit_overload": (
        conf.get_effective_workload_limit_overload,
        conf.CONFIG_KEY_WORKLOAD_LIMIT_OVERLOAD,
        0,
        24,
        "El límite de Sobrecarga",
    ),
}

CURVE_NAMES = ("cumplimiento", "vencidas", "carga", "capacidad", "consistencia", "trazabilidad")


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _audit(actor, action: str, *, previous=None, new=None, context=None, target_id="motor"):
    record_audit_event(
        actor=actor,
        action=f"kpi.{action}",
        target_type="ajuste_kpi",
        target_id=target_id,
        module=AUDIT_MODULE,
        previous_values=previous,
        new_values=new,
        context=context,
    )


# ── Pesos, umbrales y límites del motor ─────────────────────────────────────


def analytics_config_payload() -> dict:
    return {
        "config": conf.get_effective_analytics_config(timezone.now()),
        "defaults": conf.ANALYTICS_CONFIG_DEFAULTS,
        "prediction_max_days": PREDICTION_MAX_DAYS,
    }


def update_analytics_config(*, actor, body, context=None) -> dict:
    """Réplica de `AnalyticsConfigView.patch`: claves conocidas, rangos, las 3
    sumas de ponderación en 100 y el orden de los umbrales de riesgo."""
    if not isinstance(body, dict) or not body:
        raise AnalyticsError("Nada que guardar.")
    errores = {}
    for key, value in body.items():
        rule = ANALYTICS_CONFIG_VALIDATION.get(key)
        if rule is None:
            errores[key] = [f"Clave de configuración desconocida: {key}"]
            continue
        minimo, maximo = rule
        if not _is_number(value) or not (minimo <= value <= maximo):
            errores[key] = [f"Debe ser un número entre {minimo} y {maximo}."]
    if errores:
        raise AnalyticsError("Hay valores fuera de rango.", details=errores)

    current = conf.get_effective_analytics_config(timezone.now())
    merged = {**current, **body}
    for keys, label in (
        (HEALTH_WEIGHT_KEYS, "Equilibrio Operativo"),
        (PERF_WEIGHT_KEYS, "Performance Score"),
        (RISK_WEIGHT_KEYS, "Índice de Riesgo Operativo"),
    ):
        if any(k in body for k in keys):
            total = sum(merged[k] for k in keys)
            if round_half_up(total) != 100:
                raise AnalyticsError(
                    f"Las ponderaciones de {label} deben sumar 100 (suman {total})."
                )
    if not (
        merged["risk_threshold_medio"]
        < merged["risk_threshold_alto"]
        < merged["risk_threshold_critico"]
    ):
        raise AnalyticsError("Los umbrales de riesgo deben cumplir Medio < Alto < Crítico.")

    with transaction.atomic():
        for key, value in body.items():
            conf.set_analytics_config_value(key, value, actor)
        _audit(
            actor,
            "ajustes_motor",
            previous={k: current[k] for k in body},
            new=dict(body),
            context=context,
        )
    return {"config": conf.get_effective_analytics_config(timezone.now())}


def _workload_values(now) -> dict:
    valores = {
        name: getter(now) for name, (getter, _k, _mn, _mx, _l) in WORKLOAD_LIMIT_FIELDS.items()
    }
    valores["hours_per_day"] = conf.get_effective_horas_efectivas(now)
    valores["monthly_expected_hours"] = conf.get_effective_horas_esperadas_mes(now)
    return valores


def workload_config_payload() -> dict:
    return _workload_values(timezone.now())


def update_workload_config(*, actor, body, context=None) -> dict:
    """Réplica de `WorkloadConfigView.put` para los 3 límites, con el mismo
    orden obligatorio: Subutilización < Horas efectivas <= Límite óptimo <
    Sobrecarga."""
    if not isinstance(body, dict):
        raise AnalyticsError("Nada que guardar.")
    provided = {name: body[name] for name in WORKLOAD_LIMIT_FIELDS if name in body}
    if not provided:
        raise AnalyticsError("Nada que guardar.")
    for name, value in provided.items():
        _getter, _key, minimo, maximo, label = WORKLOAD_LIMIT_FIELDS[name]
        if not _is_number(value) or not (minimo <= value <= maximo):
            raise AnalyticsError(
                f"{label} debe ser un número entre {minimo} y {maximo} horas.",
                details={name: [f"Debe ser un número entre {minimo} y {maximo}."]},
            )
    current = _workload_values(timezone.now())
    merged = {**current, **provided}
    if not (
        merged["workload_limit_low"]
        < merged["hours_per_day"]
        <= merged["workload_limit_high"]
        < merged["workload_limit_overload"]
    ):
        raise AnalyticsError(
            "Los límites deben mantener el orden: Subutilización "
            f"({merged['workload_limit_low']}) < Horas efectivas ({merged['hours_per_day']}) "
            f"<= Límite óptimo ({merged['workload_limit_high']}) < Sobrecarga "
            f"({merged['workload_limit_overload']})."
        )
    with transaction.atomic():
        for name, value in provided.items():
            _getter, key, _mn, _mx, _label = WORKLOAD_LIMIT_FIELDS[name]
            conf.set_config_value(key, str(value), actor)
        _audit(
            actor,
            "ajustes_carga",
            previous={k: current[k] for k in provided},
            new=dict(provided),
            context=context,
        )
    return _workload_values(timezone.now())


def prediction_window_payload() -> dict:
    return {
        "window_weeks": conf.get_effective_prediction_window_weeks(timezone.now()),
        "options": list(conf.PREDICTION_WINDOW_OPTIONS),
    }


def update_prediction_window(*, actor, window_weeks: str, context=None) -> dict:
    anterior = conf.get_effective_prediction_window_weeks(timezone.now())
    with transaction.atomic():
        conf.set_config_value(conf.CONFIG_KEY_PREDICTION_WINDOW_WEEKS, window_weeks, actor)
        _audit(
            actor,
            "ventana_prediccion",
            previous={"window_weeks": anterior},
            new={"window_weeks": window_weeks},
            context=context,
        )
    return prediction_window_payload()


# ── Curvas de normalización ─────────────────────────────────────────────────


def curves_payload() -> dict:
    return {"curves": get_all_effective_curves(timezone.now()), "defaults": DEFAULT_CURVES}


def update_curve(*, actor, name: str, points, context=None) -> dict:
    if name not in CURVE_NAMES:
        raise AnalyticsError(f"Curva desconocida: {name}.", details={"name": ["No existe."]})
    if not is_valid_curve(points):
        raise AnalyticsError(
            "Curva inválida: se requieren al menos 2 puntos con x/y finitos e y en [0,100].",
            details={"points": ["Curva inválida."]},
        )
    if len(json.dumps(points)) > 255:
        raise AnalyticsError(
            "La curva tiene demasiados puntos para guardarse.",
            details={"points": ["Demasiados puntos."]},
        )
    with transaction.atomic():
        set_curve_config(name, points, actor)
        _audit(actor, "curva", new={"name": name, "points": points}, context=context)
    return {"curves": get_all_effective_curves(timezone.now())}


# ── Objetivo del cargo y Matriz de Compatibilidad ───────────────────────────


def role_targets_payload() -> dict:
    return {
        "targets": conf.get_all_effective_role_targets(ALL_ROLES, timezone.now()),
        "roles": ALL_ROLES,
        "role_labels": ROLE_LABEL,
    }


def update_role_target(*, actor, role: str, target: dict, context=None) -> dict:
    with transaction.atomic():
        conf.set_role_target(role, target, actor)
        _audit(actor, "objetivo_cargo", new={"role": role, "target": target}, context=context)
    return {"targets": conf.get_all_effective_role_targets(ALL_ROLES, timezone.now())}


def role_compatibility_payload() -> dict:
    return {
        "matrix": conf.get_all_effective_role_compatibility(ALL_ROLES, timezone.now()),
        "roles": ALL_ROLES,
        "role_labels": ROLE_LABEL,
        "role_levels": ROLE_LEVEL,
    }


def update_role_compatibility(*, actor, role: str, compatible_roles: list, context=None) -> dict:
    """Regla 4 (dura): nunca entre niveles jerárquicos distintos."""
    invalid = next((r for r in compatible_roles if ROLE_LEVEL[r] != ROLE_LEVEL[role]), None)
    if invalid:
        raise AnalyticsError(
            f"«{ROLE_LABEL[invalid]}» no es del mismo nivel jerárquico que «{ROLE_LABEL[role]}»: "
            "la redistribución entre niveles distintos nunca está permitida.",
            details={"compatible_roles": ["Nivel jerárquico distinto."]},
        )
    cleaned = [r for r in dict.fromkeys(compatible_roles) if r != role]
    with transaction.atomic():
        conf.set_role_compatibility(role, cleaned, actor)
        _audit(
            actor,
            "compatibilidad",
            new={"role": role, "compatible_roles": cleaned},
            context=context,
        )
    return {"matrix": conf.get_all_effective_role_compatibility(ALL_ROLES, timezone.now())}


# ── Fecha de inicio del KPI ─────────────────────────────────────────────────


def _serialize_kpi_start(user, fecha) -> dict:
    return {
        "id": user.id,
        "name": (user.get_full_name() or "").strip() or user.username,
        "email": user.email,
        "role": gh_role_of(user),
        "kpi_start_date": fecha.date().isoformat() if fecha else None,
    }


def kpi_start_dates_payload() -> list[dict]:
    """El equipo de Gestión Humana de la empresa con su fecha de inicio."""
    from .access import _gh_people_of_company

    personas = list(_gh_people_of_company().order_by("first_name", "username"))
    fechas = conf.kpi_start_dates_for(personas)
    return [_serialize_kpi_start(p, fechas.get(p.id)) for p in personas]


def set_kpi_start_date(*, actor, user_id: int, fecha, context=None) -> dict:
    """Fija o borra (`fecha=None`) la fecha de inicio del KPI de una persona
    de la empresa activa. Medianoche UTC del día, como en Nexo."""
    from apps.ausencias.services import member_of_company

    target = member_of_company(user_id)
    if target is None:
        raise AnalyticsError("Usuario no encontrado.", code="not_found", status=404)
    anterior = conf.kpi_start_date_of(target)
    nueva = datetime(fecha.year, fecha.month, fecha.day, tzinfo=dt_timezone.utc) if fecha else None
    with transaction.atomic():
        if nueva is None:
            KpiStartDate.objects.filter(user=target).delete()
        else:
            KpiStartDate.objects.update_or_create(
                user=target, defaults={"kpi_start_date": nueva, "updated_by": actor}
            )
        _audit(
            actor,
            "fecha_inicio",
            target_id=target.pk,
            previous={"kpi_start_date": anterior.date().isoformat() if anterior else None},
            new={"kpi_start_date": nueva.date().isoformat() if nueva else None},
            context=context,
        )
    return _serialize_kpi_start(target, nueva)


def member_or_404(user_id: int):
    """La cuenta si trabaja en la empresa activa; si no, 404 (no se revela si
    existe en otra)."""
    from apps.ausencias.services import member_of_company

    target = member_of_company(user_id)
    if target is None:
        raise AnalyticsError("Usuario no encontrado.", code="not_found", status=404)
    return target
