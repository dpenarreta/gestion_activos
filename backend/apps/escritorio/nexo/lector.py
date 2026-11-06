"""Lectura del Escritorio Digital de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de `apps.desk` de Nexo (0001-0008,
nombres por defecto de Django: `desk_<modelo>` y `<campo>_id`). Las notas, las
respuestas y los recordatorios tienen `created_at` y `updated_at` (su
`BaseModel`); la bitácora (`DeskAuditLog`) solo `created_at`.
`legacy_postgres_id` se añadió en la 0007 y se quitó en la 0008: no existe.

El adjunto (`attachment_data`, base64) no va en `filas`: se pide fila por fila
con `adjunto`, para no traer de golpe todos los archivos a memoria y para
comprobar con `LEN` calculado en Nexo que se leyó entero.

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona, y el JSON de la bitácora ya decodificado
(`comun.convertir`).
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import (
    MAXIMO_DE_PARAMETROS,
    ErrorDeNexo,
    LectorSQL,
    Tabla,
    convertir,
)
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = [
    "TABLAS",
    "ErrorDeNexo",
    "LectorNexoEscritorio",
    "LectorNexoEscritorioSQL",
    "convertir",
]

#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "reminder": Tabla(
        "desk_personalreminder",
        (
            "id",
            "created_at",
            "updated_at",
            "user_id",
            "title",
            "description",
            "due_at",
            "priority",
            "status",
            "repeat",
            "completed_at",
            "archived",
            "archived_at",
            "notified",
            "converted_to_task_id",
            "converted_to_task_at",
            "attachment_name",
            "attachment_mime",
        ),
        fechas_hora=_f(
            "created_at",
            "updated_at",
            "due_at",
            "completed_at",
            "archived_at",
            "converted_to_task_at",
        ),
        usuarios=("user_id",),
    ),
    "note": Tabla(
        "desk_desknote",
        (
            "id",
            "created_at",
            "updated_at",
            "sender_id",
            "recipient_id",
            "message",
            "priority",
            "color",
            "read",
            "read_at",
            "pinned",
            "archived",
            "archived_at",
            "attachment_name",
            "attachment_mime",
            "converted_to_reminder_id",
            "converted_at",
            "deleted_at",
        ),
        fechas_hora=_f(
            "created_at", "updated_at", "read_at", "archived_at", "converted_at", "deleted_at"
        ),
        usuarios=("sender_id", "recipient_id"),
    ),
    "reply": Tabla(
        "desk_desknotereply",
        ("id", "created_at", "updated_at", "note_id", "author_id", "message"),
        fechas_hora=_f("created_at", "updated_at"),
        usuarios=("author_id",),
    ),
    "log": Tabla(
        "desk_deskauditlog",
        ("id", "created_at", "entity_type", "entity_id", "user_id", "action", "metadata"),
        fechas_hora=_f("created_at"),
        json=_f("metadata"),
        usuarios=("user_id",),
    ),
}

#: Tablas con adjunto en base64.
CON_ADJUNTO = {"note": "desk_desknote", "reminder": "desk_personalreminder"}


class LectorNexoEscritorio(Protocol):
    """Lo que el importador del Escritorio necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS`."""

    def adjunto(self, tabla: str, id_nexo: int) -> dict | None:
        """`attachment_data` (el base64, tal cual, o None) y `caracteres` (`LEN`
        calculado en Nexo) de una nota o un recordatorio (`tabla` es «note» o
        «reminder»); `None` si la fila ya no existe."""

    def tareas(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `title`, `created_at`, `assigned_to_id` y `created_by_id` de
        esas tareas de Nexo (las que salieron de un recordatorio), para
        encontrarlas entre las que ya importó `importar_nexo_tareas`."""


class LectorNexoEscritorioSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)

    def adjunto(self, tabla: str, id_nexo: int) -> dict | None:
        nombre = CON_ADJUNTO[tabla]
        filas = self._select(
            "SELECT [attachment_data], CAST(LEN([attachment_data]) AS BIGINT) AS caracteres "
            f"FROM [{nombre}] WHERE [id] = %s",  # noqa: S608 (nombre fijo del código)
            [int(id_nexo)],
        )
        if not filas:
            return None
        fila = filas[0]
        return {
            "attachment_data": fila["attachment_data"],
            "caracteres": int(fila["caracteres"] or 0),
        }

    def tareas(self, ids: Iterable[int]) -> list[dict]:
        ids = sorted({int(i) for i in ids})
        resultado = []
        definicion = Tabla("tasks_task", (), fechas_hora=_f("created_at"))
        for inicio in range(0, len(ids), MAXIMO_DE_PARAMETROS):
            tramo = ids[inicio : inicio + MAXIMO_DE_PARAMETROS]
            marcas = ", ".join(["%s"] * len(tramo))
            resultado += [
                convertir(definicion, fila)
                for fila in self._select(
                    "SELECT [id], [title], [created_at], [assigned_to_id], [created_by_id] "
                    f"FROM [tasks_task] WHERE [id] IN ({marcas})",  # noqa: S608
                    tramo,
                )
            ]
        return resultado
