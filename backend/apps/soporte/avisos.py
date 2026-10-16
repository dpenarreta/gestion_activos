"""Los correos de la Mesa de ayuda. Salen por el SMTP configurado y con las
plantillas editables de Configuración → Notificaciones → Plantillas de correo.

Nunca se leen respuestas por correo: quien pidió contesta desde su enlace de
seguimiento, que va en cada aviso.
"""

from django.conf import settings
from django.utils.html import escape

from apps.alertas import eventos


def _base() -> str:
    return settings.FRONTEND_URL.rstrip("/")


def enlace_de_seguimiento(ticket) -> str:
    return f"{_base()}/soporte/seguimiento/{ticket.token}"


def datos_adicionales_html(ticket) -> str:
    """Lo respondido en los campos propios del formulario: el bloque
    `{{datos_adicionales}}`. Vacío si el formulario no tiene campos propios."""
    filas = "".join(
        '<tr><td style="padding: 4px 12px 4px 0; color: #6c757d; font-size: 13px;">'
        f'{escape(dato["etiqueta"])}</td>'
        f'<td style="padding: 4px 0; font-size: 13px;">{escape(dato["valor"])}</td></tr>'
        for dato in ticket.datos_adicionales or []
    )
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0">{filas}</table>'
        if filas
        else ""
    )


def _variables(ticket) -> dict:
    return {
        "numero": ticket.numero,
        "nombre": ticket.solicitante_nombre,
        "correo": ticket.solicitante_correo,
        "telefono": ticket.solicitante_telefono,
        "agencia": ticket.sede.nombre if ticket.sede_id else "",
        "area": ticket.area.nombre if ticket.area_id else "",
        "datos_adicionales": datos_adicionales_html(ticket),
        "categoria": ticket.categoria.nombre,
        "caso": ticket.caso.nombre,
        "prioridad": ticket.get_prioridad_display(),
        "estado": ticket.get_estado_display(),
        "empresa": ticket.empresa.nombre if ticket.empresa_id else "",
        "enlace": enlace_de_seguimiento(ticket),
    }


def _al_solicitante(clave: str, ticket, extra=None) -> bool:
    return eventos.enviar(
        clave=clave,
        variables={**_variables(ticket), **(extra or {})},
        destinatarios=eventos.Destinatarios(direcciones=[ticket.solicitante_correo]),
    )


def ticket_creado(ticket, posicion) -> bool:
    return _al_solicitante(
        "soporte.ticket_creado",
        ticket,
        {
            "posicion": str(posicion or ""),
            "fuera_de_horario": "sí" if ticket.fuera_de_horario else "",
        },
    )


def ticket_respondido(ticket, mensaje: str) -> bool:
    return _al_solicitante(
        "soporte.ticket_respondido",
        ticket,
        {"mensaje": mensaje, "tecnico": str(ticket.tecnico) if ticket.tecnico_id else ""},
    )


def ticket_atendido(ticket) -> bool:
    return _al_solicitante(
        "soporte.ticket_atendido",
        ticket,
        {
            "tecnico": str(ticket.tecnico) if ticket.tecnico_id else "",
            "dias_cierre": str(getattr(settings, "SOPORTE_DIAS_CIERRE_AUTOMATICO", 3)),
        },
    )


def _equipo(ticket) -> eventos.Destinatarios:
    """El técnico y la línea de supervisión de su nivel."""
    correos = []
    if ticket.tecnico_id and ticket.tecnico.usuario.email:
        correos.append(ticket.tecnico.usuario.email)
    for supervisor in ticket.nivel.supervisores.all():
        if supervisor.email and supervisor.email not in correos:
            correos.append(supervisor.email)
    return eventos.Destinatarios(direcciones=correos)


def _variables_del_equipo(ticket) -> dict:
    from django.utils import timezone

    vence = (
        timezone.localtime(ticket.sla_vence).strftime("%d/%m/%Y %H:%M") if ticket.sla_vence else ""
    )
    return {
        **_variables(ticket),
        "tecnico": str(ticket.tecnico) if ticket.tecnico_id else "Sin asignar",
        "nivel": str(ticket.nivel),
        "vence": vence,
        "enlace": f"{_base()}/admin/soporte/tickets/{ticket.id}",
    }


def alerta_sla(ticket) -> bool:
    return eventos.enviar(
        clave="soporte.sla_por_vencer",
        variables=_variables_del_equipo(ticket),
        destinatarios=_equipo(ticket),
    )


def sla_vencido(ticket) -> bool:
    return eventos.enviar(
        clave="soporte.sla_vencido",
        variables=_variables_del_equipo(ticket),
        destinatarios=_equipo(ticket),
    )
