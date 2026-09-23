"""Avisos de una solicitud: cuando llega y cuando se mueve.

Una bandeja sin aviso es una bandeja que se mira cuando alguien se acuerda. El
correo es lo que convierte «Solicitudes recibidas» en algo que se atiende: quien
compra se entera de que le asignaron algo, y quien pidió se entera de que su
equipo ya se compró sin tener que preguntar por el pasillo, que es como se
enteraba antes.

El envío va **después de confirmar la transacción**, igual que los avisos del
taller: un servidor de correo lento no puede retrasar el registro de una
solicitud, y uno caído no puede deshacerlo.
"""

from django.conf import settings
from django.db import transaction

from apps.alertas import eventos


def _activado() -> bool:
    return getattr(settings, "AVISAR_EVENTOS_DE_SOLICITUD", True)


def _para(usuario) -> eventos.Destinatarios:
    """El reparto hacia una cuenta del sistema.

    No pasa por `eventos.resolver`, que reparte entre fichas de empleado: aquí
    el destinatario es una cuenta, y si no tiene correo no hay a quién más
    mandarlo —avisar a quien actuó sería contarle lo que acaba de hacer—.
    """
    correo = (getattr(usuario, "email", "") or "").strip()
    if correo:
        return eventos.Destinatarios(direcciones=[correo])
    from .serializers import nombre_de

    return eventos.Destinatarios(sin_correo=[nombre_de(usuario)])


def _contexto(solicitud) -> dict:
    return {
        "solicitud": solicitud,
        "url": f"{settings.FRONTEND_URL.rstrip('/')}/admin/solicitudes/{solicitud.id}",
    }


def al_recibirla(solicitud) -> eventos.Destinatarios:
    """Avisa a quien tendrá que comprarla."""
    return _avisar(
        solicitud,
        _para(solicitud.encargado),
        asunto=f"Nueva solicitud #{solicitud.id}: {solicitud.lo_que_se_pide}",
        plantilla="emails/solicitud_recibida.html",
    )


def al_cambiar_de_estado(solicitud, nota: str = "") -> eventos.Destinatarios:
    """Avisa a quien pidió en qué punto está lo suyo."""
    return _avisar(
        solicitud,
        _para(solicitud.solicitante),
        asunto=f"Solicitud #{solicitud.id}: {solicitud.get_estado_display().lower()}",
        plantilla="emails/solicitud_actualizada.html",
        extra={"nota": nota},
    )


def _avisar(solicitud, destinatarios, *, asunto, plantilla, extra=None):
    """Programa el envío y devuelve el reparto en el acto.

    La pantalla tiene que poder decir «a Fulano no se le avisará porque su
    cuenta no tiene correo» en la misma respuesta, y eso se sabe sin haber
    enviado nada.
    """
    if not _activado():
        return destinatarios
    contexto = {**_contexto(solicitud), **(extra or {})}
    transaction.on_commit(
        lambda: eventos.enviar(
            asunto=asunto,
            plantilla=plantilla,
            contexto=contexto,
            destinatarios=destinatarios,
        )
    )
    return destinatarios
