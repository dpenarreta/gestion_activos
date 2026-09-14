"""Avisos de entrada y salida del taller.

Se disparan por el hecho, no por un reloj: quien responde por un equipo se
entera de que se lo llevaron a reparar en el momento en que se registra, y de
que volvió cuando vuelve. Un resumen diario llegaría cuando ya lo había
notado por el hueco en su escritorio.

Un mantenimiento **abierto** —sin fecha de salida— significa que el equipo está
en el taller; ponerle la fecha es sacarlo. De ahí salen los dos avisos, y de ahí
sale también el caso de la reparación que se registra ya cerrada —se arregló en
el sitio, en diez minutos—: esa manda un solo aviso, el de salida, porque
contar que entró y salió en el mismo correo es contar que se hizo.

El envío va **después de confirmar la transacción**: si se mandara dentro, un
servidor de correo lento retrasaría el guardado, y uno caído podría deshacer
una reparación ya registrada por no haber podido avisar de ella.
"""

from django.conf import settings
from django.db import transaction

from apps.alertas import eventos


def _activado() -> bool:
    """Se pueden apagar sin tocar el resumen del §19, que es otra cosa."""
    return getattr(settings, "AVISAR_EVENTOS_DE_MANTENIMIENTO", True)


def _contexto(mantenimiento) -> dict:
    activo = mantenimiento.activo
    return {
        "activo": activo,
        "mantenimiento": mantenimiento,
        "responsables": activo.resumen_de_responsables or "nadie",
        "url": f"{settings.FRONTEND_URL.rstrip('/')}/admin/activos/{activo.id}",
    }


def al_entrar_al_taller(mantenimiento, actor) -> eventos.Destinatarios:
    """Avisa de que el equipo entró a reparación."""
    return _avisar(
        mantenimiento,
        actor,
        asunto=f"Equipo en mantenimiento: {mantenimiento.activo.codigo_barras}",
        plantilla="emails/mantenimiento_entrada.html",
    )


def al_salir_del_taller(mantenimiento, actor) -> eventos.Destinatarios:
    """Avisa de que el equipo volvió, y en qué estado."""
    return _avisar(
        mantenimiento,
        actor,
        asunto=f"Equipo de vuelta: {mantenimiento.activo.codigo_barras}",
        plantilla="emails/mantenimiento_salida.html",
    )


def _avisar(mantenimiento, actor, *, asunto: str, plantilla: str) -> eventos.Destinatarios:
    """Resuelve a quién y programa el envío para después del `commit`.

    Devuelve el reparto **en el acto**, aunque el correo salga más tarde: la
    pantalla tiene que poder decir «a Fulano no se le avisará» en la misma
    respuesta, y eso se sabe sin haber enviado nada.
    """
    destinatarios = eventos.resolver(mantenimiento.activo.responsables_ordenados, actor)
    if not _activado():
        return destinatarios

    contexto = _contexto(mantenimiento)
    transaction.on_commit(
        lambda: eventos.enviar(
            asunto=asunto,
            plantilla=plantilla,
            contexto=contexto,
            destinatarios=destinatarios,
        )
    )
    return destinatarios
