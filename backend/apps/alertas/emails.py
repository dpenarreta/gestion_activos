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
from django.utils.html import escape

from apps.correos import servicio
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

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


_COLOR_SEVERIDAD = {
    "alta": "background-color: #f8d7da; color: #842029;",
    "media": "background-color: #fff3cd; color: #664d03;",
}


def detalle_html(alertas_del_contexto) -> str:
    """La tabla de alertas del resumen: el bloque `{{detalle_alertas}}`.

    La arma el sistema —cada alerta con su cantidad, su severidad y el enlace
    a su listado— y la plantilla decide dónde ponerla.
    """
    filas = []
    for alerta in alertas_del_contexto:
        color = _COLOR_SEVERIDAD.get(
            alerta["severidad"], "background-color: #e2e3e5; color: #41464b;"
        )
        filas.append(
            '<tr><td style="padding: 12px 0; border-top: 1px solid #e9ecef;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="font-size: 14px; font-weight: bold;">{escape(alerta["titulo"])}</td>'
            f'<td align="right" style="font-size: 18px; font-weight: bold;">{alerta["total"]}</td>'
            "</tr></table>"
            f'<p style="margin: 4px 0 8px; font-size: 13px; color: #6c757d;">{escape(alerta["detalle"])}</p>'
            '<span style="display: inline-block; padding: 2px 8px; border-radius: 10px; '
            f'font-size: 11px; text-transform: uppercase; {color}">'
            f'{escape(alerta["etiqueta_severidad"])}</span>'
            f'<a href="{escape(alerta["url"])}" style="margin-left: 8px; font-size: 13px; '
            'color: #0d6efd;">Ver el listado</a></td></tr>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + "".join(filas)
        + "</table>"
    )


def variables(contexto: dict, *, firma: str) -> dict:
    """Las variables de la plantilla `alertas.resumen`."""
    return {
        "total_alertas": str(contexto["total_alertas"]),
        "total_elementos": str(contexto["total_elementos"]),
        "detalle_alertas": detalle_html(contexto["alertas"]),
        "es_prueba": "sí" if contexto["es_prueba"] else "",
        "prefijo": "[PRUEBA] " if contexto["es_prueba"] else "",
        "firma": firma,
        "enlace": contexto["url_centro"],
    }


def enviar_resumen(*, alertas, direcciones: list[str], es_prueba: bool = False) -> str | None:
    """Envía el resumen. Devuelve `None` si salió bien, o el motivo del fallo.

    No propaga la excepción a propósito: quien llama necesita registrar el
    intento fallido en la bitácora de envíos, y una excepción que sube dejaría
    ese registro sin escribir —el fallo desaparecería justo cuando importa.
    """
    contexto = construir_contexto(alertas, es_prueba=es_prueba)
    # El asunto nombra la empresa porque quien trabaja en dos recibe dos correos
    # el mismo día, y sin distinguirlos el segundo parece un duplicado.
    empresa = empresa_actual()
    firma = (
        f"{empresa.nombre} · {settings.SYSTEM_NAME}"
        if empresa is not None and empresa is not SIN_EMPRESA
        else settings.SYSTEM_NAME
    )
    datos = variables(contexto, firma=firma)
    correo = servicio.renderizar("alertas.resumen", datos)
    if not es_prueba:
        from apps.notificaciones import services as campana

        campana.desde_correo(
            clave="alertas.resumen",
            asunto=correo["asunto"],
            variables=datos,
            direcciones=direcciones,
        )

    try:
        mensaje = EmailMultiAlternatives(
            subject=correo["asunto"],
            body=correo["texto"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            # El destinatario visible es el propio remitente; las personas van
            # en copia oculta (ver el docstring del módulo).
            to=[settings.DEFAULT_FROM_EMAIL],
            bcc=direcciones,
        )
        mensaje.attach_alternative(correo["html"], "text/html")
        mensaje.send()
    except Exception as error:  # noqa: BLE001
        logger.exception(
            "No se pudo enviar el resumen de alertas a %d destinatario(s)", len(direcciones)
        )
        return f"{type(error).__name__}: {error}"[:200]
    return None
