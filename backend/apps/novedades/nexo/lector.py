"""Lectura de la base de Nexo: solo SELECT, con SQL crudo y sin modelos.

Los nombres de tablas y columnas salen de las 13 migraciones de
`apps/novedades` de Nexo (nombres por defecto de Django: `<app>_<modelo>` y
`<campo>_id` para las claves foráneas). `ExitNotificationRecipient` se renombró
en la 0011 con `RenameModel`, que renombra también la tabla, así que hoy es
`novedades_collaboratornotificationrecipient`. Los usuarios son `users_user`
y sus roles `users_user_groups` + `auth_group`.

`LectorNexoSQL` es el lector real; el importador recibe cualquier objeto con
los mismos métodos (`LectorNexo`), y las pruebas usan uno en memoria.

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora
conscientes de zona (UTC: Nexo corre con `USE_TZ=True` y SQL Server guarda la
hora en UTC sin zona), fechas como `date`, importes como `Decimal` y los
campos JSON ya interpretados.
"""

from collections.abc import Iterable
from typing import Protocol

from .comun import (
    MAXIMO_DE_PARAMETROS,
    TAMANO_DE_LOTE,
    ErrorDeNexo,
    LectorSQL,
    Tabla,
    convertir,
)
from .comun import a_decimal as _decimal
from .comun import f as _f

__all__ = [
    "CLAVES_DE_AJUSTES",
    "MAXIMO_DE_PARAMETROS",
    "ROLES_OPERATIVOS",
    "TABLAS",
    "TAMANO_DE_LOTE",
    "ErrorDeNexo",
    "LectorNexo",
    "LectorNexoSQL",
    "Tabla",
    "convertir",
]


#: Claves de `SystemConfigHistory` que usa Novedades en Nexo
#: (`RecordDeadlineService.CONFIG_KEYS` y `OvertimeMonthService.CONFIG_KEY`).
CLAVES_DE_AJUSTES = (
    "novedades_worked_days_deadline_hours",
    "novedades_overtime_deadline_hours",
    "novedades_overtime_grace_hours",
)

#: Roles operativos (auth.Group) que se trasladan con `--asignar-roles`.
ROLES_OPERATIVOS = ("SUPERVISOR_OPERACIONES", "ASISTENTE_OPERACIONES", "JEFE_OPERACIONES")


#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "collaborator": Tabla(
        "novedades_collaborator",
        (
            "id",
            "cedula",
            "full_name",
            "regional",
            "area",
            "cargo",
            "status",
            "current_supervisor_id",
            "created_by_id",
            "created_at",
            "updated_at",
            "worked_days_removed_at",
            "worked_days_removed_by_id",
            "worked_days_removed_reason",
        ),
        fechas_hora=_f("created_at", "updated_at", "worked_days_removed_at"),
        usuarios=("current_supervisor_id", "created_by_id", "worked_days_removed_by_id"),
    ),
    "collaboratorassignment": Tabla(
        "novedades_collaboratorassignment",
        (
            "id",
            "collaborator_id",
            "supervisor_id",
            "started_at",
            "ended_at",
            "assigned_by_id",
            "reason",
        ),
        fechas_hora=_f("started_at", "ended_at"),
        usuarios=("supervisor_id", "assigned_by_id"),
    ),
    "collaboratorstatuschange": Tabla(
        "novedades_collaboratorstatuschange",
        (
            "id",
            "collaborator_id",
            "previous_status",
            "new_status",
            "changed_by_id",
            "reason",
            "created_at",
        ),
        fechas_hora=_f("created_at"),
        usuarios=("changed_by_id",),
    ),
    "operationalperiod": Tabla(
        "novedades_operationalperiod",
        ("id", "year", "month", "start_date", "end_date"),
        fechas=_f("start_date", "end_date"),
    ),
    "supervisorperiod": Tabla(
        "novedades_supervisorperiod",
        (
            "id",
            "period_id",
            "supervisor_id",
            "status",
            "opened_at",
            "closed_at",
            "closed_by_id",
            "summary",
        ),
        fechas_hora=_f("opened_at", "closed_at"),
        json=_f("summary"),
        usuarios=("supervisor_id", "closed_by_id"),
    ),
    "overtimemonthclose": Tabla(
        "novedades_overtimemonthclose",
        ("id", "supervisor_id", "year", "month", "closed_at", "closed_by_id", "summary"),
        fechas_hora=_f("closed_at"),
        json=_f("summary"),
        usuarios=("supervisor_id", "closed_by_id"),
    ),
    "workedday": Tabla(
        "novedades_workedday",
        (
            "id",
            "collaborator_id",
            "period_id",
            "supervisor_id",
            "date",
            "hours",
            "version",
            "updated_by_id",
            "created_at",
            "updated_at",
        ),
        fechas_hora=_f("created_at", "updated_at"),
        fechas=_f("date"),
        usuarios=("supervisor_id", "updated_by_id"),
    ),
    "overtimerecord": Tabla(
        "novedades_overtimerecord",
        (
            "id",
            "collaborator_id",
            "period_id",
            "supervisor_id",
            "date",
            "overtime_hours",
            "saturday_hours",
            "is_saturday",
            "is_sunday",
            "is_holiday",
            "work_done",
            "observations",
            "version",
            "created_by_id",
            "updated_by_id",
            "deleted_at",
            "deleted_by_id",
            "created_at",
            "updated_at",
        ),
        fechas_hora=_f("deleted_at", "created_at", "updated_at"),
        fechas=_f("date"),
        usuarios=("supervisor_id", "created_by_id", "updated_by_id", "deleted_by_id"),
    ),
    "closedperiodcorrection": Tabla(
        "novedades_closedperiodcorrection",
        (
            "id",
            "target",
            "target_id",
            "period_id",
            "supervisor_id",
            "original_values",
            "new_values",
            "reason",
            "corrected_by_id",
            "created_at",
        ),
        fechas_hora=_f("created_at"),
        json=_f("original_values", "new_values"),
        usuarios=("supervisor_id", "corrected_by_id"),
    ),
    "permissionoverride": Tabla(
        "novedades_permissionoverride",
        (
            "id",
            "user_id",
            "codename",
            "effect",
            "reason",
            "created_by_id",
            "created_at",
            "revoked_at",
            "revoked_by_id",
            "revoke_reason",
        ),
        fechas_hora=_f("created_at", "revoked_at"),
        usuarios=("user_id", "created_by_id", "revoked_by_id"),
    ),
    "overtimedepuration": Tabla(
        "novedades_overtimedepuration",
        (
            "id",
            "year",
            "month",
            "created_at",
            "created_by_id",
            "source_count",
            "source_overtime_hours",
            "source_saturday_hours",
            "supervisors_total",
            "supervisors_closed",
        ),
        fechas_hora=_f("created_at"),
        usuarios=("created_by_id",),
    ),
    "depuratedovertime": Tabla(
        "novedades_depuratedovertime",
        (
            "id",
            "depuration_id",
            "source_record_id",
            "source_id",
            "collaborator_id",
            "supervisor_id",
            "date",
            "cedula",
            "full_name",
            "regional",
            "area",
            "cargo",
            "supervisor_name",
            "orig_overtime_hours",
            "orig_saturday_hours",
            "orig_is_saturday",
            "orig_is_sunday",
            "orig_is_holiday",
            "orig_work_done",
            "orig_observations",
            "overtime_hours",
            "saturday_hours",
            "is_saturday",
            "is_sunday",
            "is_holiday",
            "work_done",
            "observations",
            "excluded",
            "version",
            "updated_at",
            "updated_by_id",
        ),
        fechas_hora=_f("updated_at"),
        fechas=_f("date"),
        usuarios=("supervisor_id", "updated_by_id"),
    ),
    "depurationchange": Tabla(
        "novedades_depurationchange",
        (
            "id",
            "depuration_id",
            "row_id",
            "field",
            "original_value",
            "old_value",
            "new_value",
            "reason",
            "actor_id",
            "created_at",
        ),
        fechas_hora=_f("created_at"),
        usuarios=("actor_id",),
    ),
    "collaboratornotificationrecipient": Tabla(
        "novedades_collaboratornotificationrecipient",
        (
            "id",
            "kind",
            "email",
            "area",
            "is_active",
            "created_at",
            "created_by_id",
            "updated_at",
            "updated_by_id",
        ),
        fechas_hora=_f("created_at", "updated_at"),
        usuarios=("created_by_id", "updated_by_id"),
    ),
    "collaboratorexitnotification": Tabla(
        "novedades_collaboratorexitnotification",
        (
            "id",
            "status_change_id",
            "collaborator_id",
            "supervisor_id",
            "changed_by_id",
            "changed_at",
            "previous_status",
            "new_status",
            "period_id",
            "snapshot",
            "status",
            "recipients",
            "attempts",
            "last_attempt_at",
            "last_error",
            "sent_at",
            "created_at",
        ),
        fechas_hora=_f("changed_at", "last_attempt_at", "sent_at", "created_at"),
        json=_f("snapshot", "recipients"),
        usuarios=("supervisor_id", "changed_by_id"),
    ),
    "collaboratorentrynotification": Tabla(
        "novedades_collaboratorentrynotification",
        (
            "id",
            "collaborator_id",
            "created_by_id",
            "created_at",
            "first_day",
            "second_day",
            "triggered_at",
            "supervisor_id",
            "period_id",
            "snapshot",
            "status",
            "recipients",
            "attempts",
            "last_attempt_at",
            "last_error",
            "sent_at",
        ),
        fechas_hora=_f("created_at", "triggered_at", "last_attempt_at", "sent_at"),
        fechas=_f("first_day", "second_day"),
        json=_f("snapshot", "recipients"),
        usuarios=("created_by_id", "supervisor_id"),
    ),
    "novedadevent": Tabla(
        "novedades_novedadevent",
        (
            "id",
            "action",
            "actor_id",
            "actor_role",
            "supervisor_id",
            "period_id",
            "target_type",
            "target_id",
            "target_label",
            "field",
            "old_value",
            "new_value",
            "reason",
            "source_file",
            "created_at",
        ),
        fechas_hora=_f("created_at"),
        usuarios=("actor_id", "supervisor_id"),
    ),
    "systemconfighistory": Tabla(
        "configuration_systemconfighistory",
        ("id", "key", "value", "valid_from", "valid_until", "updated_by_id", "created_at"),
        fechas_hora=_f("valid_from", "valid_until", "created_at"),
        usuarios=("updated_by_id",),
        filtro="[key] IN (%s, %s, %s)",
        parametros=CLAVES_DE_AJUSTES,
    ),
}


class LectorNexo(Protocol):
    """Lo que el importador necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, ordenadas por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def roles_operativos(self) -> list[dict]:
        """`user_id` y `rol` de quienes tienen un rol de `ROLES_OPERATIVOS`."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS` (con su filtro)."""

    def totales(self) -> dict:
        """Sumas de control por período, calculadas en la base de Nexo:

        - `dias[(año, mes)]`: `registros` (celdas con horas) y `horas`.
        - `extras[(año, mes)]`: de las horas extras activas, `registros`,
          `horas_extra` y `horas_sabado`.
        - `depuradas[(año, mes)]`: lo mismo para las filas no excluidas de la
          base depurada de ese mes calendario.
        """


class LectorNexoSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def roles_operativos(self) -> list[dict]:
        marcas = ", ".join(["%s"] * len(ROLES_OPERATIVOS))
        return self._select(
            "SELECT ug.[user_id] AS user_id, g.[name] AS rol "
            "FROM [users_user_groups] ug JOIN [auth_group] g ON g.[id] = ug.[group_id] "
            f"WHERE g.[name] IN ({marcas}) ORDER BY ug.[user_id], g.[name]",
            ROLES_OPERATIVOS,
        )

    def totales(self) -> dict:
        dias = self._select(
            "SELECT p.[year] AS anio, p.[month] AS mes, COUNT(w.[hours]) AS registros, "
            "SUM(w.[hours]) AS horas FROM [novedades_workedday] w "
            "JOIN [novedades_operationalperiod] p ON p.[id] = w.[period_id] "
            "GROUP BY p.[year], p.[month]"
        )
        extras = self._select(
            "SELECT p.[year] AS anio, p.[month] AS mes, COUNT(*) AS registros, "
            "SUM(o.[overtime_hours]) AS horas_extra, SUM(o.[saturday_hours]) AS horas_sabado "
            "FROM [novedades_overtimerecord] o "
            "JOIN [novedades_operationalperiod] p ON p.[id] = o.[period_id] "
            "WHERE o.[deleted_at] IS NULL GROUP BY p.[year], p.[month]"
        )
        depuradas = self._select(
            "SELECT d.[year] AS anio, d.[month] AS mes, COUNT(*) AS registros, "
            "SUM(r.[overtime_hours]) AS horas_extra, SUM(r.[saturday_hours]) AS horas_sabado "
            "FROM [novedades_depuratedovertime] r "
            "JOIN [novedades_overtimedepuration] d ON d.[id] = r.[depuration_id] "
            "WHERE r.[excluded] = 0 GROUP BY d.[year], d.[month]"
        )
        return {
            "dias": {
                (int(f["anio"]), int(f["mes"])): {
                    "registros": int(f["registros"]),
                    "horas": _decimal(f["horas"]),
                }
                for f in dias
            },
            "extras": {
                (int(f["anio"]), int(f["mes"])): {
                    "registros": int(f["registros"]),
                    "horas_extra": _decimal(f["horas_extra"]),
                    "horas_sabado": _decimal(f["horas_sabado"]),
                }
                for f in extras
            },
            "depuradas": {
                (int(f["anio"]), int(f["mes"])): {
                    "registros": int(f["registros"]),
                    "horas_extra": _decimal(f["horas_extra"]),
                    "horas_sabado": _decimal(f["horas_sabado"]),
                }
                for f in depuradas
            },
        }
