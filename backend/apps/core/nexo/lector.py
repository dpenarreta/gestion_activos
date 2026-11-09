"""Lectura de la auditoría general de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de `apps.core` de Nexo (0001-0002, nombres
por defecto de Django): `core_auditlog`, con `actor_id` hacia `users_user`.

`previous_values` y `new_values` no se decodifican aquí sino en el importador:
un JSON ilegible en una fila no debe tumbar la lectura de las demás, y allí se
cuenta y se avisa.
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import MAXIMO_DE_PARAMETROS, ErrorDeNexo, LectorSQL, Tabla
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = ["TABLAS", "ErrorDeNexo", "LectorNexoAuditoria", "LectorNexoAuditoriaSQL"]

TABLAS: dict[str, Tabla] = {
    "auditlog": Tabla(
        "core_auditlog",
        (
            "id",
            "created_at",
            "updated_at",
            "actor_id",
            "action",
            "module",
            "target_type",
            "target_id",
            "previous_values",
            "new_values",
            "result",
            "ip_address",
            "user_agent",
            "browser",
            "operating_system",
            "device",
            "location",
            "correlation_id",
        ),
        fechas_hora=_f("created_at", "updated_at"),
        usuarios=("actor_id",),
    ),
}


class LectorNexoAuditoria(Protocol):
    """Lo que el importador de la auditoría necesita de Nexo."""

    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username`, `email`, `first_name` y `last_name` de esos
        usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS`."""


class LectorNexoAuditoriaSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """Como el común, más el nombre: es lo que queda como texto de quien
        no tiene cuenta en la intranet."""
        ids = sorted({int(i) for i in ids})
        resultado = []
        for inicio in range(0, len(ids), MAXIMO_DE_PARAMETROS):
            tramo = ids[inicio : inicio + MAXIMO_DE_PARAMETROS]
            marcas = ", ".join(["%s"] * len(tramo))
            resultado += self._select(
                "SELECT [id], [username], [email], [first_name], [last_name] "
                f"FROM [users_user] WHERE [id] IN ({marcas})",  # noqa: S608 (solo marcas)
                tramo,
            )
        return resultado
