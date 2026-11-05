"""Lectura de Proyectos, Ausencias y KPI de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de Nexo (nombres por defecto de Django:
`<app>_<modelo>` y `<campo>_id` para las claves foráneas):

- `projects` (0001-0007): `legacy_postgres_id` se añadió en la 0006 y se quitó
  en la 0007, no existe. `ProjectHistory` no hereda de `BaseModel` (solo
  `created_at`). `ProjectDocument.file_data` es el base64 del archivo
  (`TextField`); NO hay columna de tamaño: el tamaño se controla con
  `LEN(file_data)` calculado en Nexo (ver `documento` y `totales`).
- `recovery` (0001-0003): `RecoveryItem` sin `updated_at`; `entity_id` es
  texto suelto. Solo interesan las filas con `entity_type = 'PROJECT'` (las de
  `DESK_NOTE` son del Escritorio Digital, que no se porta).
- `configuration` (0002): `LeaveRecord` y `SpecialStatus` heredan de
  `BaseModel`. `SystemConfigHistory.value` es `TextField` desde la 0006.
- `analytics` (0001-0003): `AnalyticsAuditLog` solo tiene `created_at`.
- `users` (0003): `kpi_start_date` es una columna de `users_user`.

**Retención médica (LOPDP).** Los `LeaveRecord` MÉDICOS anteriores al corte de
retención (`apps.ausencias.services.medical_retention_cutoff`, cinco años) ni
siquiera se leen: el filtro va en la consulta, con el corte como parámetro. De
ellos solo se pide un conteo agregado (cuántos y entre qué fechas), sin
personas ni observaciones.

**Documentos.** El listado de documentos no trae el base64: se pide uno por
uno (`documento`), para no tener todos los archivos en memoria a la vez.

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona, fechas sin hora como `date` y los JSON interpretados
(ver `comun.convertir`).
"""

from collections.abc import Iterable
from dataclasses import replace
from datetime import date, datetime
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla, a_decimal, convertir
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = [
    "CLAVES_EXACTAS",
    "CLAVES_EXCLUIDAS",
    "ENTIDAD_PROYECTO",
    "PREFIJOS_DE_CLAVE",
    "TABLAS",
    "TIPO_MEDICO",
    "ErrorDeNexo",
    "LectorNexoGH",
    "LectorNexoGHSQL",
    "convertir",
    "es_clave_de_gh",
]

#: `RecoveryItem.entity_type` de los proyectos en Nexo.
ENTIDAD_PROYECTO = "PROJECT"

#: Tipo de `LeaveRecord` que es dato de salud.
TIPO_MEDICO = "MEDICO"

#: Ajustes de `SystemConfigHistory` que pasan: todo `analytics_*` (pesos,
#: umbrales, curvas de normalización, objetivo del cargo y compatibilidad por
#: rol), los límites del semáforo de carga y tres claves sueltas.
PREFIJOS_DE_CLAVE = ("analytics_", "workload_limit_")
CLAVES_EXACTAS = (
    "prediction_window_weeks",
    "capacity_workday_end_hour_local",
    "recovery_center_retention_hours",
)
#: Marcador interno del panel de diagnóstico de Nexo, no un ajuste: la
#: intranet lo escribe sola la primera vez que se abre el panel.
CLAVES_EXCLUIDAS = ("analytics_engine_version_seen",)


def es_clave_de_gh(clave: str) -> bool:
    """La misma selección que hace el filtro SQL de `systemconfighistory`."""
    if clave in CLAVES_EXCLUIDAS:
        return False
    return clave in CLAVES_EXACTAS or any(clave.startswith(p) for p in PREFIJOS_DE_CLAVE)


_BASE = ("id", "created_at", "updated_at")
_FECHAS_BASE = ("created_at", "updated_at")

#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "project": Tabla(
        "projects_project",
        (
            *_BASE,
            "name",
            "description",
            "status",
            "priority",
            "area",
            "tags",
            "observations",
            "start_date",
            "target_date",
            "target_time_hours",
            "real_hours",
            "completed_at",
            "responsible_id",
            "created_by_id",
            "deleted_at",
        ),
        fechas_hora=_f(*_FECHAS_BASE, "start_date", "target_date", "completed_at", "deleted_at"),
        json=_f("tags"),
        usuarios=("responsible_id", "created_by_id"),
    ),
    "projectparticipant": Tabla(
        "projects_projectparticipant",
        (*_BASE, "project_id", "user_id", "added_by_id", "added_at"),
        fechas_hora=_f(*_FECHAS_BASE, "added_at"),
        usuarios=("user_id", "added_by_id"),
    ),
    "projectphase": Tabla(
        "projects_projectphase",
        (
            *_BASE,
            "project_id",
            "name",
            "status",
            "responsible_id",
            "start_date",
            "target_date",
            "progress",
            "notes",
            "target_time_hours",
            "order",
        ),
        fechas_hora=_f(*_FECHAS_BASE, "start_date", "target_date"),
        usuarios=("responsible_id",),
    ),
    "projectactivity": Tabla(
        "projects_projectactivity",
        (
            *_BASE,
            "project_id",
            "phase_id",
            "author_id",
            "description",
            "comments",
            "start_time",
            "end_time",
            "duration",
            "is_retroactive",
            "activity_date",
        ),
        fechas_hora=_f(*_FECHAS_BASE, "activity_date"),
        usuarios=("author_id",),
    ),
    "projectcomment": Tabla(
        "projects_projectcomment",
        (*_BASE, "project_id", "author_id", "text"),
        fechas_hora=_f(*_FECHAS_BASE),
        usuarios=("author_id",),
    ),
    # Sin `file_data`: el contenido se pide documento por documento.
    "projectdocument": Tabla(
        "projects_projectdocument",
        (
            *_BASE,
            "project_id",
            "activity_id",
            "category",
            "file_name",
            "mime_type",
            "version",
            "previous_version_id",
            "uploaded_by_id",
        ),
        fechas_hora=_f(*_FECHAS_BASE),
        usuarios=("uploaded_by_id",),
    ),
    "projecthistory": Tabla(
        "projects_projecthistory",
        (
            "id",
            "project_id",
            "actor_id",
            "event",
            "description",
            "previous_value",
            "new_value",
            "created_at",
        ),
        fechas_hora=_f("created_at"),
        json=_f("previous_value", "new_value"),
        usuarios=("actor_id",),
    ),
    "recoveryitem": Tabla(
        "recovery_recoveryitem",
        (
            "id",
            "entity_type",
            "entity_id",
            "entity_label",
            "module_label",
            "status",
            "deleted_by_id",
            "deleted_at",
            "retention_hours",
            "expires_at",
            "restored_by_id",
            "restored_at",
            "purged_by_id",
            "purged_at",
            "purge_origin",
            "created_at",
        ),
        fechas_hora=_f("deleted_at", "expires_at", "restored_at", "purged_at", "created_at"),
        usuarios=("deleted_by_id", "restored_by_id", "purged_by_id"),
        filtro="[entity_type] = %s",
        parametros=(ENTIDAD_PROYECTO,),
    ),
    # El corte de retención lo pone cada lector (`LectorNexoGHSQL`). Aquí va
    # con `date.max`, que deja fuera TODO lo médico: sin corte, no se lee nada
    # de salud.
    "leaverecord": Tabla(
        "configuration_leaverecord",
        (
            *_BASE,
            "user_id",
            "type",
            "date",
            "is_full_day",
            "duration_minutes",
            "observation",
            "created_by_id",
        ),
        fechas_hora=_f(*_FECHAS_BASE),
        fechas=_f("date"),
        usuarios=("user_id", "created_by_id"),
        filtro="NOT ([type] = %s AND [date] < %s)",
        parametros=(TIPO_MEDICO, date.max),
    ),
    "specialstatus": Tabla(
        "configuration_specialstatus",
        (
            *_BASE,
            "user_id",
            "type",
            "start_date",
            "end_date",
            "is_active",
            "daily_hours",
            "limit_low",
            "limit_base",
            "limit_high",
            "limit_overload",
            "created_by_id",
        ),
        fechas_hora=_f(*_FECHAS_BASE),
        fechas=_f("start_date", "end_date"),
        usuarios=("user_id", "created_by_id"),
    ),
    "analyticsauditlog": Tabla(
        "analytics_analyticsauditlog",
        ("id", "user_id", "kind", "period", "inputs", "result", "engine_version", "created_at"),
        fechas_hora=_f("created_at"),
        json=_f("inputs", "result"),
        usuarios=("user_id",),
    ),
    # Una fila por usuario de Nexo con fecha de inicio del KPI. La persona no
    # es «necesaria»: si no tiene cuenta en la intranet, se lista y se omite.
    "kpistartdate": Tabla(
        "users_user",
        ("id", "username", "email", "kpi_start_date"),
        fechas_hora=_f("kpi_start_date"),
        filtro="[kpi_start_date] IS NOT NULL",
    ),
    "systemconfighistory": Tabla(
        "configuration_systemconfighistory",
        ("id", "key", "value", "valid_from", "valid_until", "updated_by_id", "created_at"),
        fechas_hora=_f("valid_from", "valid_until", "created_at"),
        usuarios=("updated_by_id",),
        filtro=("([key] LIKE %s OR [key] LIKE %s OR [key] IN (%s, %s, %s)) AND [key] NOT IN (%s)"),
        # `_` es comodín en LIKE: `[_]` lo hace literal.
        parametros=("analytics[_]%", "workload[_]limit[_]%", *CLAVES_EXACTAS, *CLAVES_EXCLUIDAS),
    ),
}

#: Mes de control de un registro de horas: el de su fecha de actividad (los
#: retroactivos) o, si no tiene, el de su creación. En UTC, en ambos lados.
_MES_DE_ACTIVIDAD = "COALESCE([activity_date], [created_at])"


class LectorNexoGH(Protocol):
    """Lo que el importador de la fase 2b necesita de Nexo."""

    #: Primer día que se conserva de los permisos MÉDICOS; lo anterior no se
    #: lee ni se importa.
    corte_medico: date

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]` (con su filtro), por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS` (con su filtro)."""

    def documento(self, id_nexo: int) -> dict | None:
        """`file_data` (el base64, tal cual) y `caracteres` (`LEN` calculado
        en Nexo) de un documento; `None` si ya no existe."""

    def totales(self) -> dict:
        """Sumas de control calculadas en la base de Nexo:

        - `proyectos`: `registros`, `horas_objetivo` y `horas_reales`.
        - `actividades[(año, mes)]`: `registros` y `minutos` de los registros
          de horas de Proyectos de ese mes (UTC; fecha de actividad o, si no
          tiene, de creación).
        - `ausencias[(año, mes)]`: `registros`, `minutos` (suma de
          `duration_minutes`) y `dias_completos` de los permisos que se
          importan (sin los médicos vencidos), por el mes de `date`.
        - `medicos_vencidos`: `registros`, `desde` y `hasta` de los permisos
          médicos anteriores al corte (solo agregado).
        - `documentos`: `registros` y `caracteres` (suma de `LEN(file_data)`).
        """


class LectorNexoGHSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    def __init__(self, alias: str = ALIAS_NEXO, *, corte_medico: date):
        super().__init__(alias)
        self.corte_medico = corte_medico
        ausencias = TABLAS["leaverecord"]
        self.tablas = {
            **TABLAS,
            "leaverecord": replace(ausencias, parametros=(TIPO_MEDICO, corte_medico)),
        }

    def documento(self, id_nexo: int) -> dict | None:
        filas = self._select(
            "SELECT [file_data], CAST(LEN([file_data]) AS BIGINT) AS caracteres "
            "FROM [projects_projectdocument] WHERE [id] = %s",
            [int(id_nexo)],
        )
        if not filas:
            return None
        fila = filas[0]
        return {"file_data": fila["file_data"], "caracteres": int(fila["caracteres"] or 0)}

    def totales(self) -> dict:
        proyectos = self._select(
            "SELECT COUNT(*) AS registros, SUM([target_time_hours]) AS horas_objetivo, "
            "SUM([real_hours]) AS horas_reales FROM [projects_project]"
        )[0]
        actividades = self._select(
            f"SELECT YEAR({_MES_DE_ACTIVIDAD}) AS anio, MONTH({_MES_DE_ACTIVIDAD}) AS mes, "
            "COUNT(*) AS registros, SUM(CAST([duration] AS BIGINT)) AS minutos "
            "FROM [projects_projectactivity] "
            f"GROUP BY YEAR({_MES_DE_ACTIVIDAD}), MONTH({_MES_DE_ACTIVIDAD})"
        )
        ausencias = self._select(
            "SELECT YEAR([date]) AS anio, MONTH([date]) AS mes, COUNT(*) AS registros, "
            "SUM(CAST(COALESCE([duration_minutes], 0) AS BIGINT)) AS minutos, "
            "SUM(CASE WHEN [is_full_day] = 1 THEN 1 ELSE 0 END) AS dias_completos "
            "FROM [configuration_leaverecord] WHERE NOT ([type] = %s AND [date] < %s) "
            "GROUP BY YEAR([date]), MONTH([date])",
            [TIPO_MEDICO, self.corte_medico],
        )
        vencidos = self._select(
            "SELECT COUNT(*) AS registros, MIN([date]) AS desde, MAX([date]) AS hasta "
            "FROM [configuration_leaverecord] WHERE [type] = %s AND [date] < %s",
            [TIPO_MEDICO, self.corte_medico],
        )[0]
        documentos = self._select(
            "SELECT COUNT(*) AS registros, "
            "SUM(CAST(LEN([file_data]) AS BIGINT)) AS caracteres "
            "FROM [projects_projectdocument]"
        )[0]
        return {
            "proyectos": {
                "registros": int(proyectos["registros"]),
                "horas_objetivo": a_decimal(proyectos["horas_objetivo"]),
                "horas_reales": a_decimal(proyectos["horas_reales"]),
            },
            "actividades": {
                (int(f["anio"]), int(f["mes"])): {
                    "registros": int(f["registros"]),
                    "minutos": int(f["minutos"] or 0),
                }
                for f in actividades
            },
            "ausencias": {
                (int(f["anio"]), int(f["mes"])): {
                    "registros": int(f["registros"]),
                    "minutos": int(f["minutos"] or 0),
                    "dias_completos": int(f["dias_completos"] or 0),
                }
                for f in ausencias
            },
            "medicos_vencidos": {
                "registros": int(vencidos["registros"]),
                "desde": _fecha(vencidos["desde"]),
                "hasta": _fecha(vencidos["hasta"]),
            },
            "documentos": {
                "registros": int(documentos["registros"]),
                "caracteres": int(documentos["caracteres"] or 0),
            },
        }


def _fecha(valor) -> date | None:
    if valor is None:
        return None
    if isinstance(valor, str):
        return date.fromisoformat(valor[:10])
    if isinstance(valor, datetime):
        return valor.date()
    return valor
