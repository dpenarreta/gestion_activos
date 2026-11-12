"""Los permisos que da tener a alguien a cargo siguen al organigrama (US-013).

`permisos_por_cargo.POR_TENER_EQUIPO` (hoy, `llamados.solicitar`) lo lleva el
rol de todo cargo al que le reporta otro cargo **activo**. Cambiar un cargo
cambia a dos jefes: al que tenía y al que tiene ahora; borrarlo o
desactivarlo puede dejar sin equipo a su jefe; y la línea punteada
(`Cargo.jefes_secundarios`) cuenta igual que la directa. Por eso no basta con
recalcular el cargo que se editó (`asegurar_rol`): cada cambio que mueve el
equipo recalcula los roles de los cargos de su empresa
(`sincronizar_por_equipo`, unas pocas consultas).

**Solo cuando cambia algo que importa** (QA-TECH, 12/11/2026): el jefe, la
empresa, el rol o si el cargo está activo. Guardar el nombre, el perfil o las
plazas no recalcula nada. Un cargo nuevo sin jefe tampoco: no le cambia el
equipo a nadie (su línea punteada llega después por `m2m_changed`).

**En lote** (`en_lote()`): los caminos que tocan muchos cargos seguidos —
restaurar una versión del organigrama, levantar un área— juntan las empresas
afectadas y recalculan una sola vez al terminar, en vez de una por cargo. Si
el bloque falla, no recalcula (la transacción se deshace igual).

Un `QuerySet.update(jefe=…)` no dispara señales; donde se usa (restaurar una
versión) va dentro de un lote y le sigue un `asegurar_rol` por cargo.
"""

import threading
from contextlib import ContextDecorator

from django.db.models.signals import m2m_changed, post_delete, post_init, post_save
from django.dispatch import receiver

from .models import Cargo
from .permisos_por_cargo import sincronizar_por_equipo

#: Lo que, si cambia en un cargo, puede cambiar quién tiene equipo.
CAMPOS_QUE_IMPORTAN = ("jefe_id", "empresa_id", "rol_id", "activo")
_NOMBRES_DE_CAMPO = {"jefe", "jefe_id", "empresa", "empresa_id", "rol", "rol_id", "activo"}

_local = threading.local()


def _pendientes():
    """Las empresas por recalcular del lote en curso, o None si no hay lote."""
    return getattr(_local, "pendientes", None)


class en_lote(ContextDecorator):  # noqa: N801 — se usa como `with en_lote():`
    """Junta los recálculos de un bloque y los hace una vez por empresa al
    salir. Se puede anidar: recalcula al cerrar el más externo."""

    def __enter__(self):
        _local.profundidad = getattr(_local, "profundidad", 0) + 1
        if _local.profundidad == 1:
            _local.pendientes = set()
        return self

    def __exit__(self, tipo, valor, traza):
        _local.profundidad -= 1
        if _local.profundidad:
            return False
        pendientes, _local.pendientes = _local.pendientes, None
        if tipo is None:
            for empresa_id in sorted(pendientes):
                sincronizar_por_equipo(empresa_id)
        return False


def recalcular(empresa_id) -> None:
    """Recalcula ya, o al cerrar el lote en curso."""
    if empresa_id is None:
        return
    pendientes = _pendientes()
    if pendientes is not None:
        pendientes.add(empresa_id)
    else:
        sincronizar_por_equipo(empresa_id)


def _foto(instance) -> tuple:
    # Del `__dict__`: un campo diferido (`.only()`) no se consulta solo por esto.
    return tuple(instance.__dict__.get(campo) for campo in CAMPOS_QUE_IMPORTAN)


@receiver(post_init, sender=Cargo, dispatch_uid="llamados_equipo_cargo_cargado")
def _cargo_cargado(sender, instance, **kwargs):
    instance._equipo_antes = _foto(instance)


@receiver(post_save, sender=Cargo, dispatch_uid="llamados_equipo_cargo_guardado")
def _cargo_guardado(sender, instance, created=False, raw=False, update_fields=None, **kwargs):
    antes = getattr(instance, "_equipo_antes", None)
    instance._equipo_antes = _foto(instance)
    if raw:  # cargando datos (loaddata): ahí no hay roles que tocar
        return
    if created:
        if instance.jefe_id is None:
            return
    elif update_fields is not None:
        if not _NOMBRES_DE_CAMPO & set(update_fields):
            return
    elif antes is not None and antes == instance._equipo_antes:
        return
    recalcular(instance.empresa_id)
    if antes is not None and antes[1] not in (None, instance.empresa_id):
        recalcular(antes[1])  # cambió de empresa: también la de antes


@receiver(post_delete, sender=Cargo, dispatch_uid="llamados_equipo_cargo_borrado")
def _cargo_borrado(sender, instance, **kwargs):
    recalcular(instance.empresa_id)


@receiver(
    m2m_changed,
    sender=Cargo.jefes_secundarios.through,
    dispatch_uid="llamados_equipo_reporte_secundario",
)
def _reportes_secundarios(sender, instance, action, **kwargs):
    if action in {"post_add", "post_remove", "post_clear"}:
        recalcular(instance.empresa_id)
