"""Envío del resumen de alertas por correo (§19 del documento funcional).

El correo lleva **solo el recuento de cada alerta y el enlace al listado**: ni
la muestra de equipos que sí viaja en la respuesta de la API, ni el nombre de
ningún custodio. Un correo sale del perímetro del sistema hacia buzones que
este no controla —se reenvía, se archiva, se sincroniza con el teléfono— y
allí no rigen los permisos que protegen la pantalla. Para saber que hay que
actuar basta el número; el detalle está a un clic, detrás del login.

Por la misma razón las direcciones van en copia oculta: la lista de quién
recibe los avisos del parque no es algo que cada destinatario necesite.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger("apps.alertas")

ETIQUETA_SEVERIDAD = {
    "alta": "Atender ya",
    "media": "Revisar",
    "baja": "Informativa",
}


def _url_frontend(ruta: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{ruta}"


def construir_contexto(alertas, *, es_prueba: bool = False) -> dict:
    """Datos del correo a partir de las alertas ya calculadas.

    Recibe las alertas en vez de calcularlas para que el envío programado y el
    de prueba muestren exactamente lo mismo: una prueba que consulta el parque
    por su cuenta podría verse bien y aun así no representar lo que llega.
    """
    con_pendientes = [alerta for alerta in alertas if alerta.total > 0]
    return {
        "system_name": settings.SYSTEM_NAME,
        "es_prueba": es_prueba,
        "alertas": [
            {
                "titulo": alerta.titulo,
                "severidad": alerta.severidad,
                "etiqueta_severidad": ETIQUETA_SEVERIDAD.get(alerta.severidad, "Informativa"),
                "total": alerta.total,
                "detalle": alerta.detalle,
                "url": _url_frontend(alerta.destino),
            }
            for alerta in con_pendientes
        ],
        "total_alertas": len(con_pendientes),
        "total_elementos": sum(alerta.total for alerta in con_pendientes),
        "url_centro": _url_frontend("/admin/alertas"),
    }


def _texto_plano(contexto: dict) -> str:
    """Versión en texto del mismo resumen.

    No es un adorno: hay clientes de correo corporativos que bloquean el HTML
    de remitentes internos automáticos, y un correo que llega vacío es
    indistinguible de uno que no llegó.
    """
    if not contexto["alertas"]:
        cuerpo = "Ninguna alerta activa tiene equipos pendientes."
    else:
        lineas = [
            f"- [{alerta['etiqueta_severidad']}] {alerta['titulo']}: "
            f"{alerta['total']} — {alerta['detalle']}"
            for alerta in contexto["alertas"]
        ]
        cuerpo = "\n".join(lineas)
    return (
        f"Resumen de alertas de {contexto['system_name']}\n\n"
        f"{cuerpo}\n\n"
        f"Ver el detalle: {contexto['url_centro']}\n"
    )


def enviar_resumen(*, alertas, direcciones: list[str], es_prueba: bool = False) -> str | None:
    """Envía el resumen. Devuelve `None` si salió bien, o el motivo del fallo.

    No propaga la excepción a propósito: quien llama necesita registrar el
    intento fallido en la bitácora de envíos, y una excepción que sube dejaría
    ese registro sin escribir —el fallo desaparecería justo cuando importa.
    """
    contexto = construir_contexto(alertas, es_prueba=es_prueba)
    prefijo = "[PRUEBA] " if es_prueba else ""
    if contexto["total_alertas"]:
        asunto = (
            f"{prefijo}{contexto['total_alertas']} alerta(s) del parque "
            f"— {settings.SYSTEM_NAME}"
        )
    else:
        asunto = f"{prefijo}Sin alertas pendientes — {settings.SYSTEM_NAME}"

    try:
        mensaje = EmailMultiAlternatives(
            subject=asunto,
            body=_texto_plano(contexto),
            from_email=settings.DEFAULT_FROM_EMAIL,
            # El destinatario visible es el propio remitente; las personas van
            # en copia oculta (ver el docstring del módulo).
            to=[settings.DEFAULT_FROM_EMAIL],
            bcc=direcciones,
        )
        mensaje.attach_alternative(
            render_to_string("emails/alertas_resumen.html", contexto), "text/html"
        )
        mensaje.send()
    except Exception as error:  # noqa: BLE001
        logger.exception(
            "No se pudo enviar el resumen de alertas a %d destinatario(s)", len(direcciones)
        )
        return f"{type(error).__name__}: {error}"[:200]
    return None
