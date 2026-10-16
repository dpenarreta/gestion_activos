"""Avisos del inventario de activos.

Por ahora uno solo: que llegó el equipo que alguien pidió.

**Un alta normal no avisa a nadie.** Una compra de reposición no la pide nadie
en particular, y un correo por cada equipo que entra al inventario es ruido —del
que se aprende a ignorar, y entonces tampoco se lee el que sí importaba—. Solo
se avisa cuando el alta dice quién lo pidió.
"""

from django.conf import settings
from django.db import transaction

from apps.alertas import eventos


def _activado() -> bool:
    """Se pueden apagar sin tocar el resumen del §19, que es otra cosa."""
    return getattr(settings, "AVISAR_EVENTOS_DE_MANTENIMIENTO", True)


def al_llegar_lo_solicitado(activo, actor) -> eventos.Destinatarios | None:
    """Avisa a quien pidió el equipo de que ya está registrado.

    Devuelve `None` si nadie lo pidió, que es distinto de «no se pudo avisar a
    nadie»: en el primer caso no había a quién, y en el segundo sí y no se
    pudo. La pantalla dice cosas distintas para cada uno.
    """
    if activo.solicitado_por_id is None:
        return None

    destinatarios = eventos.resolver([activo.solicitado_por], actor)
    if not _activado():
        return destinatarios

    datos = variables(activo)
    transaction.on_commit(
        lambda: eventos.enviar(
            clave="activos.llego_lo_solicitado", variables=datos, destinatarios=destinatarios
        )
    )
    return destinatarios


def variables_del_equipo(activo) -> dict:
    """Lo que dicen del equipo todos los avisos sobre un equipo."""
    return {
        "equipo": activo.nombre,
        "codigo": activo.codigo_barras,
        "serie": activo.numero_serie or "",
        "enlace": f"{settings.FRONTEND_URL.rstrip('/')}/admin/activos/{activo.id}",
    }


def variables(activo) -> dict:
    """Las variables del aviso «Llegó el equipo que pidió»."""
    return {
        **variables_del_equipo(activo),
        "tipo": activo.tipo.nombre if activo.tipo_id else "",
        "area": activo.departamento.nombre if activo.departamento_id else "",
        "condicion": activo.get_condicion_display() if activo.condicion else "",
    }
