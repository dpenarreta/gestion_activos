"""Lectura de las «Solicitudes LOPD» de Nexo: solo SELECT, con SQL crudo.

El nombre sale de la migración 0001 de `apps.data_requests` de Nexo (nombres
por defecto de Django: `data_requests_datasubjectrequest` y `<campo>_id`). La
0002 añadió `legacy_postgres_id` y la 0003 la quitó: no existe.

Lo que devuelve un lector ya viene con tipos de Python: fechas con hora en UTC
y conscientes de zona (`comun.convertir`).
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = ["TABLAS", "ErrorDeNexo", "LectorNexoPrivacidad", "LectorNexoPrivacidadSQL"]

#: Lo que se migra. La clave es el nombre lógico que usan el importador, el
#: informe y las pruebas.
TABLAS: dict[str, Tabla] = {
    "solicitud": Tabla(
        "data_requests_datasubjectrequest",
        (
            "id",
            "created_at",
            "updated_at",
            "user_id",
            "type",
            "description",
            "status",
            "resolved_by_id",
            "resolved_at",
        ),
        fechas_hora=_f("created_at", "updated_at", "resolved_at"),
        usuarios=("user_id", "resolved_by_id"),
    ),
}


class LectorNexoPrivacidad(Protocol):
    """Lo que el importador necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS`."""


class LectorNexoPrivacidadSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)
