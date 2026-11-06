"""Lectura de los informes ejecutivos de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de `apps.reports` de Nexo (0001-0005,
nombres por defecto de Django: `reports_<modelo>` y `<campo>_id`):

- `ExecutiveReportSnapshot` y `ExecutiveReportAuditLog`: sin `updated_at`.
  `legacy_postgres_id` se añadió en la 0003 y se quitó en la 0005: no existe.
- `ExecutiveReportIntegrityIncident` (0002): `user_id` es un entero suelto,
  sin FK.
- `MonthlyReport` (0004) no se lee: no se porta (ver `apps.informes.models`).

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona, y los JSON interpretados (`comun.convertir`).
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla, convertir
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = ["TABLAS", "ErrorDeNexo", "LectorNexoInformes", "LectorNexoInformesSQL", "convertir"]

#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "snapshot": Tabla(
        "reports_executivereportsnapshot",
        (
            "id",
            "report_id",
            "type",
            "scope",
            "origin",
            "integrity_flag",
            "legacy_monthly_report_id",
            "migrated_at",
            "generated_by_id",
            "generated_at",
            "period_label",
            "period_start",
            "period_end",
            "fecha_corte",
            "period_status",
            "filters",
            "collaborator_ids",
            "collaborator_count",
            "analytics_engine_version",
            "formula_set_version",
            "reporting_engine_version",
            "nexo_version",
            "data",
            "nova",
            "nova_degraded",
            "data_quality",
            "generation_ms",
            "created_at",
        ),
        fechas_hora=_f(
            "migrated_at", "generated_at", "period_start", "period_end", "fecha_corte", "created_at"
        ),
        json=_f("filters", "collaborator_ids", "data", "nova", "data_quality"),
        usuarios=("generated_by_id",),
    ),
    "auditlog": Tabla(
        "reports_executivereportauditlog",
        (
            "id",
            "report_id",
            "action",
            "user_id",
            "step",
            "message",
            "period",
            "fecha_corte",
            "filters_applied",
            "collaborator_count",
            "generation_ms",
            "analytics_engine_version",
            "formula_set_version",
            "nexo_version",
            "created_at",
        ),
        fechas_hora=_f("fecha_corte", "created_at"),
        json=_f("filters_applied"),
        usuarios=("user_id",),
    ),
    # `user_id` no es una FK: no está en `usuarios` (si no tiene cuenta en la
    # intranet, no aborta; queda en nulo y se avisa).
    "incident": Tabla(
        "reports_executivereportintegrityincident",
        (
            "id",
            "report_id",
            "field_path",
            "expected_value",
            "actual_value",
            "source",
            "user_id",
            "detected_at",
        ),
        fechas_hora=_f("detected_at"),
    ),
}


class LectorNexoInformes(Protocol):
    """Lo que el importador de informes necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS`."""


class LectorNexoInformesSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)
