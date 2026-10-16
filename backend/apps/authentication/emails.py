"""Envío de correos transaccionales del flujo de autenticación
(restablecimiento de contraseña). Una falla de envío nunca debe propagar
una excepción: rompería la respuesta genérica de los endpoints públicos de
recuperación (ver `apps.authentication.services.PasswordResetService`), que
debe ser idéntica exista o no la cuenta."""

import logging

from django.conf import settings
from django.core.mail import send_mail

from apps.correos import servicio

logger = logging.getLogger("apps.authentication")


def _send_transactional_email(*, clave: str, variables: dict, to: str) -> None:
    """Envía un correo de la cuenta con su plantilla (`apps.correos`)."""
    try:
        correo = servicio.renderizar(clave, variables)
        send_mail(
            subject=correo["asunto"],
            message=correo["texto"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[to],
            html_message=correo["html"],
        )
    except Exception:
        logger.exception("No se pudo enviar el correo %r a %s", clave, to)


def _variables_de_la_cuenta(user) -> dict:
    return {
        "nombre": user.first_name or user.username,
        "usuario": user.username,
        "correo": user.email,
    }


def send_password_reset_email(*, user, raw_token: str) -> None:
    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={raw_token}"
    _send_transactional_email(
        clave="acceso.recuperar_contrasena",
        variables={
            **_variables_de_la_cuenta(user),
            "enlace": reset_url,
            "minutos": str(settings.PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES),
        },
        to=user.email,
    )


def send_password_changed_notification(*, user) -> None:
    _send_transactional_email(
        clave="acceso.contrasena_cambiada",
        variables=_variables_de_la_cuenta(user),
        to=user.email,
    )
