"""El correo del sistema, en Configuración → Notificaciones.

Todos los avisos —el resumen de alertas, los recordatorios de la Matriz, el
restablecimiento de contraseña— salen por el mismo servidor de salida. Esta
pantalla dice por cuál, y deja comprobar que funciona sin esperar a que llegue
(o no llegue) un aviso de verdad.

La configuración vive en el `.env` y no se edita desde aquí: la clave del buzón
no debe pasar por una pantalla ni guardarse en la base. Tampoco se muestra.
"""

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.audit import record_audit_event
from apps.core.request_meta import get_request_context
from apps.permissions.permissions import HasModulePermission

#: Nombre legible de los backends de correo que se usan.
BACKENDS = {
    "django.core.mail.backends.smtp.EmailBackend": "Servidor SMTP",
    "django.core.mail.backends.console.EmailBackend": "Consola (no se envía nada)",
    "django.core.mail.backends.locmem.EmailBackend": "Memoria (pruebas)",
    "django.core.mail.backends.filebased.EmailBackend": "Archivos (no se envía nada)",
}


class CorreoPermission(HasModulePermission):
    view_permission = "configuracion.ver"
    write_permission = "configuracion.editar"


def estado_del_correo() -> dict:
    """Por dónde sale el correo, sin la clave."""
    backend = settings.EMAIL_BACKEND
    smtp = backend.endswith("smtp.EmailBackend")
    return {
        "backend": BACKENDS.get(backend, backend),
        "envia_de_verdad": smtp,
        "servidor": settings.EMAIL_HOST if smtp else None,
        "puerto": settings.EMAIL_PORT if smtp else None,
        "cifrado": (
            (
                "STARTTLS"
                if getattr(settings, "EMAIL_USE_TLS", False)
                else "SSL" if getattr(settings, "EMAIL_USE_SSL", False) else "Ninguno"
            )
            if smtp
            else None
        ),
        "usuario": (settings.EMAIL_HOST_USER or None) if smtp else None,
        "remitente": settings.DEFAULT_FROM_EMAIL,
        "espera_segundos": getattr(settings, "EMAIL_TIMEOUT", None),
        "enlace_de_los_avisos": settings.FRONTEND_URL,
    }


class CorreoDelSistemaView(APIView):
    """Lee por dónde sale el correo."""

    permission_classes = [IsAuthenticated, CorreoPermission]

    def get(self, request):
        return Response(estado_del_correo())


class PruebaDeCorreoView(APIView):
    """Envía un correo de prueba a quien lo pide, y a nadie más.

    Con su propio límite, como la prueba de alertas: un endpoint que dispara
    correos no debe poder usarse para inundar un buzón.
    """

    permission_classes = [IsAuthenticated, CorreoPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "correo_prueba"

    def post(self, request):
        destino = request.user.email
        if not destino:
            return Response(
                {"detail": "Su cuenta no tiene un correo registrado al que enviar la prueba."},
                status=400,
            )
        estado = estado_del_correo()
        error = None
        try:
            mensaje = EmailMultiAlternatives(
                subject=f"[PRUEBA] Correo de {settings.SYSTEM_NAME}",
                body=(
                    f"Este es un correo de prueba de {settings.SYSTEM_NAME}.\n\n"
                    "Si lo está leyendo, el servidor de salida funciona: los "
                    "resúmenes de alertas y los recordatorios de la Matriz "
                    "salen por el mismo camino.\n"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[destino],
            )
            mensaje.send(fail_silently=False)
        except Exception as fallo:  # noqa: BLE001
            # Cualquier fallo de SMTP se devuelve legible: es justo lo que se
            # vino a averiguar.
            error = str(fallo) or fallo.__class__.__name__

        record_audit_event(
            actor=request.user,
            action="correo.prueba_enviada",
            module="configuracion",
            new_values={"destino": destino, "resultado": "fallido" if error else "enviado"},
            context=get_request_context(request),
        )
        if error:
            return Response(
                {
                    "detail": "No se pudo enviar el correo de prueba.",
                    "motivo": error[:500],
                },
                status=502,
            )
        if not estado["envia_de_verdad"]:
            return Response(
                {
                    "detail": (
                        f"El sistema está en modo «{estado['backend']}»: el correo se dio por "
                        "enviado, pero no salió a ningún buzón."
                    ),
                    "simulado": True,
                }
            )
        return Response({"detail": f"Se envió un correo de prueba a {destino}."})
