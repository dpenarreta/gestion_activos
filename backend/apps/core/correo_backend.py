"""Backend de correo que descarta las direcciones que no existen (US-021).

Las cuentas creadas desde nómina sin correo reciben
`usuario@sin-correo.invalid` (TLD reservado, RFC 2606), porque en la intranet
el correo es obligatorio y único. Este backend envuelve al real
(`EMAIL_BACKEND_REAL`, el que dice el .env) y quita esas direcciones de
`to`, `cc` y `bcc` en todos los envíos del sistema, en un solo lugar. Un
correo que se queda sin destinatarios no sale.
"""

from django.conf import settings
from django.core.mail import get_connection
from django.core.mail.backends.base import BaseEmailBackend

DOMINIO = "@sin-correo.invalid"


def _validas(direcciones):
    return [
        d for d in (direcciones or []) if not str(d).strip().lower().rstrip(">").endswith(DOMINIO)
    ]


class SinCorreosReservados(BaseEmailBackend):
    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently)
        self._real = get_connection(
            backend=settings.EMAIL_BACKEND_REAL, fail_silently=fail_silently, **kwargs
        )

    def open(self):
        return self._real.open()

    def close(self):
        return self._real.close()

    def send_messages(self, email_messages):
        salen = []
        for mensaje in email_messages or []:
            mensaje.to = _validas(mensaje.to)
            mensaje.cc = _validas(mensaje.cc)
            mensaje.bcc = _validas(mensaje.bcc)
            if mensaje.to or mensaje.cc or mensaje.bcc:
                salen.append(mensaje)
        if not salen:
            return 0
        return self._real.send_messages(salen)


def backend_real() -> str:
    """El backend que de verdad envía: el del .env, no este filtro. Si alguien
    fijó `EMAIL_BACKEND` directamente (las pruebas), ese manda."""
    if settings.EMAIL_BACKEND == "apps.core.correo_backend.SinCorreosReservados":
        return getattr(settings, "EMAIL_BACKEND_REAL", settings.EMAIL_BACKEND)
    return settings.EMAIL_BACKEND
