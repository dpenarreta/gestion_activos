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

    contexto = {
        "activo": activo,
        "url": f"{settings.FRONTEND_URL.rstrip('/')}/admin/activos/{activo.id}",
    }
    transaction.on_commit(
        lambda: eventos.enviar(
            asunto=f"Llegó el equipo que pidió: {activo.nombre}",
            plantilla="emails/activo_solicitado.html",
            contexto=contexto,
            destinatarios=destinatarios,
        )
    )
    return destinatarios
