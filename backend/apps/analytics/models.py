"""Modelos del motor de KPI (Gestión Humana, fase 2b, 05/11/2026), portados de
`apps.analytics` de Nexo.

Las versiones del motor y de las fórmulas son las de Nexo y no cambian: los
resultados deben ser idénticos con los mismos datos. Solo se sube una versión
cuando una fórmula CAMBIA de resultado.

Multiempresa: los dos modelos heredan de `ModeloDeEmpresa`, así que su gestor
los acota a la empresa activa (la auditoría de cálculos y la fecha de inicio
de una persona en una empresa no se ven desde otra).
"""

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa

#: Mismo valor que `ANALYTICS_ENGINE_VERSION` de Nexo (`src/lib/analytics.ts`).
ANALYTICS_ENGINE_VERSION = "1.5.0"

#: Mismo valor que `FORMULA_SET_VERSION` de Nexo.
FORMULA_SET_VERSION = "4.4"

#: Réplica exacta de `FORMULA_VERSIONS` de Nexo: versión de cada fórmula de
#: negocio, independiente del motor como un todo.
FORMULA_VERSIONS: dict[str, str] = {
    "carga_laboral": "1.0",
    "equilibrio_operativo": "1.1",
    "score_simple": "1.0",
    "capacidad_disponible": "1.1",
    "riesgo_operativo": "1.0",
    "cumplimiento": "2.0",
    "consistencia": "2.1",
    "prediccion": "2.0",
    "performance_score": "4.0",
    "trazabilidad": "4.0",
    "benchmark_inteligente": "1.0",
    "completado_a_tiempo": "1.0",
}

#: Réplica de `AUDIT_KIND_FORMULAS` de Nexo: `kind` de `AnalyticsAuditLog` →
#: fórmulas de negocio involucradas.
AUDIT_KIND_FORMULAS: dict[str, list[str]] = {
    "performance_score": ["performance_score", "cumplimiento", "consistencia", "trazabilidad"],
    "health_score": [
        "equilibrio_operativo",
        "carga_laboral",
        "cumplimiento",
        "consistencia",
        "capacidad_disponible",
    ],
    "operational_risk": ["riesgo_operativo"],
    "alerts": [],
    "validation_failure": [],
}


class AnalyticsAuditLog(ModeloDeEmpresa):
    """Auditoría append-only de los cálculos y validaciones del motor: cada
    evento es una fila nueva, nunca se edita ni se borra. Además de auditar,
    es la memoria del motor: la tendencia del Riesgo Operativo, el historial
    de alertas resueltas, el Trend Engine y el Benchmark Personal leen lo que
    se calculó antes. Guarda puntajes y factores, nunca el tipo de una
    ausencia."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="analytics_audit_logs", on_delete=models.CASCADE
    )
    kind = models.CharField(max_length=100)
    period = models.CharField(max_length=7)  # "YYYY-MM"
    inputs = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    engine_version = models.CharField(max_length=20)

    class Meta:
        indexes = [models.Index(fields=["empresa", "user", "kind", "period"])]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.kind}:{self.period}"


class KpiStartDate(ModeloDeEmpresa):
    """Desde cuándo se mide a una persona en la empresa (en Nexo,
    `User.kpi_start_date`): quien entra a mitad de mes no se mide contra el
    mes entero. Medianoche UTC del día, como en Nexo."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="kpi_start_dates", on_delete=models.CASCADE
    )
    kpi_start_date = models.DateTimeField()
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "user"], name="analytics_kpistartdate_empresa_user_uniq"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.kpi_start_date:%Y-%m-%d}"
