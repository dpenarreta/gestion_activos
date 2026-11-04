"""Enrutamiento de bases: la de Nexo es de solo lectura.

El alias `nexo` (ver `config/settings/base.py`) existe solo mientras dura la
migración del Control Operativo de Novedades. Se lee con SQL crudo y nunca con
modelos, así que este router no envía nada allí: su trabajo es negarse.

- `allow_migrate` → False: un `migrate --database nexo` no crea ni altera nada.
- `db_for_write` nunca devuelve `nexo`, y `allow_relation` no relaciona objetos
  de `nexo` con los de otra base.
- Como un `.using("nexo")` explícito salta los routers, la propia conexión
  rechaza toda sentencia que no sea un SELECT (`solo_select`, que se instala al
  abrirla: ver `apps.novedades.apps`).
"""

from django.db import DatabaseError

ALIAS_NEXO = "nexo"


class EscrituraEnNexo(DatabaseError):
    """Se intentó ejecutar en la base de Nexo algo distinto de un SELECT."""


class NexoSoloLecturaRouter:
    def db_for_read(self, model, **hints):
        return None

    def db_for_write(self, model, **hints):
        instancia = hints.get("instance")
        if instancia is not None and getattr(instancia._state, "db", None) == ALIAS_NEXO:
            raise EscrituraEnNexo("La base de Nexo es de solo lectura.")
        return None

    def allow_relation(self, obj1, obj2, **hints):
        if ALIAS_NEXO in (obj1._state.db, obj2._state.db):
            return obj1._state.db == obj2._state.db == ALIAS_NEXO
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if db == ALIAS_NEXO:
            return False
        return None


def es_select(sql: str) -> bool:
    """Una sola sentencia y que sea un SELECT (sin `;` que encadene otra)."""
    texto = str(sql or "").strip()
    return texto[:6].upper() == "SELECT" and ";" not in texto.rstrip(";")


def solo_select(execute, sql, params, many, context):
    """`execute_wrapper` de la conexión `nexo`: deja pasar solo SELECT."""
    if many or not es_select(sql):
        raise EscrituraEnNexo("La base de Nexo es de solo lectura: solo se permiten SELECT.")
    return execute(sql, params, many, context)


def proteger_conexion_nexo(sender, connection, **kwargs):
    """Receptor de `connection_created`: instala `solo_select` en la conexión
    de Nexo (una vez por objeto de conexión, aunque se reconecte)."""
    if connection.alias == ALIAS_NEXO and solo_select not in connection.execute_wrappers:
        connection.execute_wrappers.append(solo_select)
