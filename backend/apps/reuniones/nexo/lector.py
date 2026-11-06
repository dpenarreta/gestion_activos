"""Lectura de las Reuniones de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de `apps.meetings` de Nexo (0001-0003,
nombres por defecto de Django: `meetings_<modelo>` y `<campo>_id`). Las dos
tablas tienen `created_at` y `updated_at` (su `BaseModel`).
`legacy_postgres_id` se añadió en la 0002 y se quitó en la 0003: no existe.

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona (`comun.convertir`).
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla, convertir
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = ["TABLAS", "ErrorDeNexo", "LectorNexoReuniones", "LectorNexoReunionesSQL", "convertir"]

#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "meeting": Tabla(
        "meetings_meeting",
        (
            "id",
            "created_at",
            "updated_at",
            "title",
            "description",
            "host_id",
            "meeting_date",
            "duration",
            "zoom_meeting_id",
            "zoom_join_url",
            "zoom_password",
            "status",
            "otter_invited",
            "otter_summary",
            "otter_transcript_url",
        ),
        fechas_hora=_f("created_at", "updated_at", "meeting_date"),
        usuarios=("host_id",),
    ),
    "invitee": Tabla(
        "meetings_meetinginvitee",
        ("id", "created_at", "updated_at", "meeting_id", "user_id", "attended"),
        fechas_hora=_f("created_at", "updated_at"),
        usuarios=("user_id",),
    ),
}


class LectorNexoReuniones(Protocol):
    """Lo que el importador de Reuniones necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS`."""


class LectorNexoReunionesSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)
