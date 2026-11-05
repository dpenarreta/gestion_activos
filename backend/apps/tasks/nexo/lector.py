"""Lectura de las tablas de Tareas de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las 8 migraciones de `apps/tasks` de Nexo (app label
`tasks`, nombres por defecto de Django: `tasks_<modelo>` y `<campo>_id` para
las claves foráneas). Lo que conviene saber del esquema de Nexo:

- `legacy_postgres_id` se añadió en la 0006 y se quitó en la 0007: no existe.
- `ActivityAuditLog` y `MonthClosure` no heredan de `BaseModel`: no tienen
  `created_at`/`updated_at` (la fecha es `modified_at` y `closed_at`).
- `TargetTimeAuditLog.task_id`, `EndDateAuditLog.task_id` y
  `ActivityAuditLog.activity_id` son enteros sueltos, sin FK.
- Los ajustes vienen de `configuration_systemconfighistory` (`value` es
  `TextField` desde la 0006 de `configuration`). Las reglas de aviso son UNA
  clave con JSON (`notification_rules`).

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona, y los JSON interpretados (ver `comun.convertir`).
"""

from collections.abc import Iterable
from decimal import Decimal
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla, a_decimal, convertir
from apps.novedades.nexo.comun import f as _f

__all__ = [
    "CLAVES_DE_AJUSTES",
    "CLAVE_REGLAS_DE_AVISO",
    "TABLAS",
    "ErrorDeNexo",
    "LectorNexoTareas",
    "LectorNexoTareasSQL",
    "convertir",
]

#: Reglas de aviso de Nexo (`CONFIG_KEY_NOTIFICATION_RULES`): un JSON con
#: `comment_targets`, `first_comment_role` y `retroactive_notify_roles`.
CLAVE_REGLAS_DE_AVISO = "notification_rules"

#: Claves de `SystemConfigHistory` que usa Tareas en Nexo.
CLAVES_DE_AJUSTES = (
    "HORAS_EFECTIVAS_DIA",
    "HORAS_ESPERADAS_MES",
    "retroactive_window_business_days",
    CLAVE_REGLAS_DE_AVISO,
)

_BASE = ("id", "created_at", "updated_at")
_FECHAS_BASE = ("created_at", "updated_at")

#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "activityreason": Tabla(
        "tasks_activityreason",
        (
            *_BASE,
            "key",
            "label",
            "description",
            "is_active",
            "is_archived",
            "archived_at",
            "assigned_roles",
        ),
        fechas_hora=_f(*_FECHAS_BASE, "archived_at"),
        json=_f("assigned_roles"),
    ),
    "task": Tabla(
        "tasks_task",
        (
            *_BASE,
            "title",
            "description",
            "status",
            "priority",
            "frequency",
            "type",
            "start_date",
            "end_date",
            "estimated_hours",
            "real_hours",
            "target_time_validated",
            "target_time_validated_at",
            "target_time_validated_by_id",
            "end_date_approval_status",
            "end_date_approved_at",
            "end_date_approved_by_id",
            "progress",
            "completed_at",
            "color",
            "archived_month",
            "archived_at",
            "successor_created_at",
            "corrected",
            "assigned_to_id",
            "created_by_id",
        ),
        fechas_hora=_f(
            *_FECHAS_BASE,
            "start_date",
            "end_date",
            "target_time_validated_at",
            "end_date_approved_at",
            "completed_at",
            "archived_at",
            "successor_created_at",
        ),
        usuarios=(
            "target_time_validated_by_id",
            "end_date_approved_by_id",
            "assigned_to_id",
            "created_by_id",
        ),
    ),
    "comment": Tabla(
        "tasks_comment",
        (*_BASE, "task_id", "author_id", "text"),
        fechas_hora=_f(*_FECHAS_BASE),
        usuarios=("author_id",),
    ),
    "taskcommentview": Tabla(
        "tasks_taskcommentview",
        (*_BASE, "task_id", "user_id"),
        fechas_hora=_f(*_FECHAS_BASE),
        usuarios=("user_id",),
    ),
    "taskactivity": Tabla(
        "tasks_taskactivity",
        (
            *_BASE,
            "task_id",
            "author_id",
            "reason",
            "start_time",
            "end_time",
            "duration",
            "description",
            "is_retroactive",
            "activity_date",
            "admin_comment",
            "modified_by_admin",
            "modified_at",
        ),
        fechas_hora=_f(*_FECHAS_BASE, "activity_date", "modified_at"),
        usuarios=("author_id",),
    ),
    "activitycomment": Tabla(
        "tasks_activitycomment",
        (*_BASE, "activity_id", "author_id", "text"),
        fechas_hora=_f(*_FECHAS_BASE),
        usuarios=("author_id",),
    ),
    "activityauditlog": Tabla(
        "tasks_activityauditlog",
        ("id", "activity_id", "admin_id", "old_duration", "new_duration", "comment", "modified_at"),
        fechas_hora=_f("modified_at"),
        usuarios=("admin_id",),
    ),
    "targettimeauditlog": Tabla(
        "tasks_targettimeauditlog",
        (
            *_BASE,
            "task_id",
            "user_id",
            "user_role",
            "previous_value",
            "new_value",
            "reason",
            "reason_detail",
            "ip_address",
        ),
        fechas_hora=_f(*_FECHAS_BASE),
        usuarios=("user_id",),
    ),
    "enddateauditlog": Tabla(
        "tasks_enddateauditlog",
        (
            *_BASE,
            "task_id",
            "user_id",
            "user_role",
            "action",
            "previous_value",
            "new_value",
            "observaciones",
            "ip_address",
        ),
        fechas_hora=_f(*_FECHAS_BASE, "previous_value", "new_value"),
        usuarios=("user_id",),
    ),
    "monthclosure": Tabla(
        "tasks_monthclosure",
        (
            "id",
            "month",
            "year",
            "closed_by_id",
            "closed_at",
            "cutoff_date",
            "closure_type",
            "calendar_days_total",
            "calendar_days_considered",
            "working_days_considered",
            "working_hours_considered",
            "total_tasks",
            "completed_tasks",
            "summary",
            "corrections",
        ),
        fechas_hora=_f("closed_at", "cutoff_date"),
        json=_f("summary", "corrections"),
        usuarios=("closed_by_id",),
    ),
    "systemconfighistory": Tabla(
        "configuration_systemconfighistory",
        ("id", "key", "value", "valid_from", "valid_until", "updated_by_id", "created_at"),
        fechas_hora=_f("valid_from", "valid_until", "created_at"),
        usuarios=("updated_by_id",),
        filtro="[key] IN (%s, %s, %s, %s)",
        parametros=CLAVES_DE_AJUSTES,
    ),
}

#: Mes de control de un registro de horas: el de su fecha de actividad (los
#: retroactivos) o, si no tiene, el de su creación. En UTC, en ambos lados.
_MES_DE_ACTIVIDAD = "COALESCE([activity_date], [created_at])"


class LectorNexoTareas(Protocol):
    """Lo que el importador de Tareas necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, ordenadas por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS` (con su filtro)."""

    def totales(self) -> dict:
        """Sumas de control calculadas en la base de Nexo:

        - `tareas[archived_month o ""]`: `registros`, `horas_estimadas` y
          `horas_reales` de las tareas (las vigentes, con mes vacío).
        - `actividades[(año, mes)]`: `registros` y `minutos` (suma de
          `duration`) de los registros de horas de ese mes (UTC).
        """


class LectorNexoTareasSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def totales(self) -> dict:
        tareas = self._select(
            "SELECT [archived_month] AS mes, COUNT(*) AS registros, "
            "SUM([estimated_hours]) AS horas_estimadas, SUM([real_hours]) AS horas_reales "
            "FROM [tasks_task] GROUP BY [archived_month]"
        )
        actividades = self._select(
            f"SELECT YEAR({_MES_DE_ACTIVIDAD}) AS anio, MONTH({_MES_DE_ACTIVIDAD}) AS mes, "
            "COUNT(*) AS registros, SUM(CAST([duration] AS BIGINT)) AS minutos "
            "FROM [tasks_taskactivity] "
            f"GROUP BY YEAR({_MES_DE_ACTIVIDAD}), MONTH({_MES_DE_ACTIVIDAD})"
        )
        # NULL y "" son lo mismo (tarea vigente): se suman en una sola fila.
        por_mes: dict[str, dict] = {}
        for fila in tareas:
            c = por_mes.setdefault(
                fila["mes"] or "",
                {"registros": 0, "horas_estimadas": Decimal(0), "horas_reales": Decimal(0)},
            )
            c["registros"] += int(fila["registros"])
            c["horas_estimadas"] += a_decimal(fila["horas_estimadas"])
            c["horas_reales"] += a_decimal(fila["horas_reales"])
        return {
            "tareas": por_mes,
            "actividades": {
                (int(f["anio"]), int(f["mes"])): {
                    "registros": int(f["registros"]),
                    "minutos": int(f["minutos"] or 0),
                }
                for f in actividades
            },
        }
