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


def variables(solicitud, para, nota: str = "") -> dict:
    """Las variables de los avisos de una solicitud; `para` es quien lo recibe."""
    from .serializers import nombre_de

    estado = solicitud.get_estado_display()
    return {
        "numero": str(solicitud.id),
        "que_se_pide": solicitud.lo_que_se_pide,
        "cantidad": str(solicitud.cantidad),
        "prioridad": solicitud.get_prioridad_display(),
        "fecha_necesaria": (
            solicitud.fecha_necesaria.strftime("%d/%m/%Y") if solicitud.fecha_necesaria else ""
        ),
        "justificacion": solicitud.justificacion,
        "solicitante": nombre_de(solicitud.solicitante),
        "estado": estado,
        "estado_minusculas": estado.lower(),
        "motivo": nota or "",
        "nombre": nombre_de(para),
        "correo": getattr(para, "email", "") or "",
        "enlace": f"{settings.FRONTEND_URL.rstrip('/')}/admin/solicitudes/{solicitud.id}",
    }


def al_recibirla(solicitud) -> eventos.Destinatarios:
    """Avisa a quien tendrá que comprarla."""
    return _avisar(
        _para(solicitud.encargado),
        clave="solicitudes.recibida",
        datos=variables(solicitud, solicitud.encargado),
    )


def al_cambiar_de_estado(solicitud, nota: str = "") -> eventos.Destinatarios:
    """Avisa a quien pidió en qué punto está lo suyo."""
    return _avisar(
        _para(solicitud.solicitante),
        clave="solicitudes.actualizada",
        datos=variables(solicitud, solicitud.solicitante, nota),
    )


def _avisar(destinatarios, *, clave, datos):
    """Programa el envío y devuelve el reparto en el acto.

    La pantalla tiene que poder decir «a Fulano no se le avisará porque su
    cuenta no tiene correo» en la misma respuesta, y eso se sabe sin haber
    enviado nada.
    """
    if not _activado():
        return destinatarios
    transaction.on_commit(
        lambda: eventos.enviar(clave=clave, variables=datos, destinatarios=destinatarios)
    )
    return destinatarios
