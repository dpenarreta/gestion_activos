"""El correo de una solicitud de permiso aprobada (US-019, 13/11/2026).

Sale a quienes el tipo de permiso marca «también por correo» en sus avisos
de «Si se aprueba» (por ejemplo, la Analista de Clima y Cultura, que registra
la novedad del mes). Lleva los datos de la solicitud y su documento de
respaldo adjunto, como pide el flujo de Gestión Humana.

Usa la plantilla editable `licencias.solicitud_aprobada` (Configuración ›
Plantillas de correo). La campana ya la envía `services._terminar`, así que
aquí no se repite (`con_campana=False`). Nunca levanta: un SMTP caído no
deshace la aprobación (`eventos.enviar`).
"""

import logging

from django.conf import settings

from apps.alertas import eventos

logger = logging.getLogger(__name__)

CLAVE = "licencias.solicitud_aprobada"


def _nombre(usuario) -> str:
    return usuario.get_full_name().strip() or usuario.username


def _fechas(solicitud) -> str:
    desde = solicitud.desde.strftime("%d/%m/%Y")
    hasta = solicitud.hasta.strftime("%d/%m/%Y")
    texto = desde if desde == hasta else f"del {desde} al {hasta}"
    if solicitud.hora_desde and solicitud.hora_hasta:
        texto = f"{texto}, de {solicitud.hora_desde:%H:%M} a {solicitud.hora_hasta:%H:%M}"
    return texto


def _adjunto(solicitud):
    """`[(nombre, bytes, tipo)]` con el documento de respaldo, o vacío."""
    if not solicitud.adjunto:
        return []
    try:
        with solicitud.adjunto.open("rb") as archivo:
            contenido = archivo.read()
    except Exception:  # noqa: BLE001 — sin el archivo, el correo sale igual
        logger.exception("No se pudo leer el adjunto de la solicitud %s", solicitud.pk)
        return []
    nombre = solicitud.adjunto_nombre or solicitud.adjunto.name.rsplit("/", 1)[-1]
    return [(nombre, contenido, solicitud.adjunto_tipo or "application/octet-stream")]


def variables(solicitud) -> dict:
    from .models import AccionSolicitud

    aprobadores = [
        _nombre(a.actor)
        for a in solicitud.acciones.filter(accion=AccionSolicitud.Accion.APROBADA)
        .select_related("actor")
        .order_by("id")
        if a.actor_id
    ]
    return {
        "nombre": _nombre(solicitud.solicitante),
        "correo": solicitud.solicitante.email or "",
        "tipo": solicitud.flujo.nombre,
        "fechas": _fechas(solicitud),
        "motivo": solicitud.motivo or "",
        "aprobado_por": ", ".join(dict.fromkeys(aprobadores)),
        "adjunto": "sí" if solicitud.adjunto else "",
        "enlace": f"{settings.FRONTEND_URL.rstrip('/')}/admin/institucional/permisos"
        f"?solicitud={solicitud.pk}",
    }


def solicitud_aprobada(solicitud, personas) -> bool:
    direcciones = sorted({p.email for p in personas if getattr(p, "email", "")})
    if not direcciones:
        return False
    return eventos.enviar(
        clave=CLAVE,
        variables=variables(solicitud),
        destinatarios=eventos.Destinatarios(direcciones=direcciones),
        adjuntos=_adjunto(solicitud),
        con_campana=False,
    )
