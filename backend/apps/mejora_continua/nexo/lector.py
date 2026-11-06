"""Lectura de la Mejora continua de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de `apps.ideas` de Nexo (0001-0003,
nombres por defecto de Django: `ideas_<modelo>` y `<campo>_id`). Las tres
tablas tienen `created_at` y `updated_at` (su `BaseModel`). `legacy_postgres_id`
se añadió en la 0002 y se quitó en la 0003: no existe.

El adjunto (`attachment_data`, base64) no va en `filas`: se pide idea por idea
con `adjunto`, para no traer de golpe todos los archivos a memoria y para
comprobar con `LEN` calculado en Nexo que se leyó entero.

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona (`comun.convertir`).
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla, convertir
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = ["TABLAS", "ErrorDeNexo", "LectorNexoIdeas", "LectorNexoIdeasSQL", "convertir"]

_FECHAS = _f("created_at", "updated_at")

#: Lo que se migra, en orden de dependencias. La clave es el nombre lógico que
#: usan el importador, el informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "idea": Tabla(
        "ideas_improvementidea",
        (
            "id",
            "created_at",
            "updated_at",
            "title",
            "description",
            "impact",
            "status",
            "progress",
            "author_id",
            "attachment_name",
            "attachment_mime",
        ),
        fechas_hora=_FECHAS,
        usuarios=("author_id",),
    ),
    "vote": Tabla(
        "ideas_ideavote",
        ("id", "created_at", "updated_at", "idea_id", "user_id"),
        fechas_hora=_FECHAS,
        usuarios=("user_id",),
    ),
    "history": Tabla(
        "ideas_ideastatushistory",
        (
            "id",
            "created_at",
            "updated_at",
            "idea_id",
            "from_status",
            "to_status",
            "changed_by_id",
            "comment",
        ),
        fechas_hora=_FECHAS,
        usuarios=("changed_by_id",),
    ),
}

#: Cómo guardaba Nexo la insignia en `users_user.badges` (una lista JSON).
INSIGNIA_INNOVADOR = '%"innovador"%'


class LectorNexoIdeas(Protocol):
    """Lo que el importador de Mejora continua necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS`."""

    def adjunto(self, id_nexo: int) -> dict | None:
        """`attachment_data` (el base64, tal cual, o None) y `caracteres` (`LEN`
        calculado en Nexo) de una idea; `None` si la idea ya no existe."""

    def innovadores(self) -> list[int]:
        """Ids de los usuarios de Nexo con la insignia «innovador»."""


class LectorNexoIdeasSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)

    def adjunto(self, id_nexo: int) -> dict | None:
        filas = self._select(
            "SELECT [attachment_data], CAST(LEN([attachment_data]) AS BIGINT) AS caracteres "
            "FROM [ideas_improvementidea] WHERE [id] = %s",
            [int(id_nexo)],
        )
        if not filas:
            return None
        fila = filas[0]
        return {
            "attachment_data": fila["attachment_data"],
            "caracteres": int(fila["caracteres"] or 0),
        }

    def innovadores(self) -> list[int]:
        filas = self._select(
            "SELECT [id] FROM [users_user] WHERE [badges] LIKE %s", [INSIGNIA_INNOVADOR]
        )
        return [int(f["id"]) for f in filas]
