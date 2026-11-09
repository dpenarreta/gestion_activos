"""Lectura del consentimiento de datos de Nexo: solo SELECT, con SQL crudo.

Los nombres salen de las migraciones de Nexo (nombres por defecto de Django):

- `users_user.data_consent_accepted` y `data_consent_accepted_at` (Fase 13):
  quién tiene hoy el consentimiento dado y desde cuándo. Nexo no guardaba más
  que el último valor: restablecer lo borraba.
- `configuration_systemconfighistory` con `key = 'consent_text'`: el texto del
  aviso con su vigencia (`valid_from`, `valid_until`), para guardar con cada
  aceptación el texto que regía cuando se dio.
"""

from collections.abc import Iterable
from typing import Protocol

from apps.novedades.nexo.comun import ErrorDeNexo, LectorSQL, Tabla
from apps.novedades.nexo.comun import f as _f
from config.db_routers import ALIAS_NEXO

__all__ = [
    "TABLAS",
    "ErrorDeNexo",
    "LectorNexoConsentimiento",
    "LectorNexoConsentimientoSQL",
]

TABLAS: dict[str, Tabla] = {
    # Una fila por usuario con el consentimiento dado.
    "aceptacion": Tabla(
        "users_user",
        ("id", "username", "email", "data_consent_accepted_at"),
        fechas_hora=_f("data_consent_accepted_at"),
        usuarios=("id",),
        filtro="[data_consent_accepted] = %s",
        parametros=(True,),
    ),
    # Las versiones del texto del aviso (solo se lee, no se crea nada con ellas).
    "texto": Tabla(
        "configuration_systemconfighistory",
        ("id", "value", "valid_from", "valid_until"),
        fechas_hora=_f("valid_from", "valid_until"),
        filtro="[key] = %s",
        parametros=("consent_text",),
    ),
}


class LectorNexoConsentimiento(Protocol):
    def filas(self, tabla: str) -> list[dict]:
        """Todas las filas de `TABLAS[tabla]`, por id."""

    def usuarios(self, ids: Iterable[int]) -> list[dict]:
        """`id`, `username` y `email` de esos usuarios de Nexo."""

    def conteos(self) -> dict[str, int]:
        """`COUNT(*)` de cada tabla de `TABLAS` (con su filtro)."""


class LectorNexoConsentimientoSQL(LectorSQL):
    """Lector real sobre `connections["nexo"]` (ver `comun.LectorSQL`)."""

    tablas = TABLAS

    def __init__(self, alias: str = ALIAS_NEXO):
        super().__init__(alias)
