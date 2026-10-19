"""Indicadores de la Mesa de ayuda para Reportes → Mesa de ayuda."""

import datetime
from decimal import Decimal

from django.db.models import Sum

from . import etiquetas
from .models import Canal, ConfiguracionMesa, HorasFueraDeHorario, Prioridad, Ticket, TipoTicket

Estado = Ticket.Estado


def _porcentaje(parte, total):
    return round(100 * parte / total, 1) if total else None


def filtrar(queryset, parametros):
    """Periodo (`AAAA` o `AAAA-MM`, por fecha de creación) y categoría."""
    periodo = (parametros.get("periodo") or "").strip()
    if periodo:
        try:
            if len(periodo) == 7:
                inicio = datetime.date(int(periodo[:4]), int(periodo[5:7]), 1)
                fin = (inicio + datetime.timedelta(days=32)).replace(day=1)
            else:
                inicio = datetime.date(int(periodo), 1, 1)
                fin = datetime.date(int(periodo) + 1, 1, 1)
            queryset = queryset.filter(created_at__date__gte=inicio, created_at__date__lt=fin)
        except ValueError:
            pass
    categoria = parametros.get("categoria")
    if categoria and str(categoria).isdigit():
        queryset = queryset.filter(categoria_id=int(categoria))
    return queryset


def _cumplio(ticket) -> bool | None:
    if not ticket.atendido_en:
        return None
    if ticket.sla_cumplido is not None:
        return ticket.sla_cumplido
    if not ticket.sla_vence:
        return None
    return ticket.atendido_en <= ticket.sla_vence


def _respondio_a_tiempo(ticket) -> bool | None:
    if not ticket.respondido_en or not ticket.sla_respuesta_vence:
        return None
    return ticket.respondido_en <= ticket.sla_respuesta_vence


def resumen(queryset) -> dict:
    tickets = list(
        queryset.select_related("categoria", "area", "tecnico__usuario", "nivel", "encuesta")
    )
    atendidos = [t for t in tickets if t.atendido_en]
    medidos = [c for c in (_cumplio(t) for t in atendidos) if c is not None]
    respuestas = [c for c in (_respondio_a_tiempo(t) for t in tickets) if c is not None]
    encuestas = [t.encuesta for t in tickets if getattr(t, "encuesta", None)]
    configuracion = ConfiguracionMesa.objects.first() or ConfiguracionMesa()
    # Resolución en el primer contacto: atendido en el primer nivel, sin escalar.
    en_primer_contacto = [t for t in atendidos if t.escalamientos == 0 and t.nivel.orden == 1]
    # Cycle time: desde que el técnico lo toma hasta que lo atiende. Lead time:
    # desde que entra a la cola hasta la primera respuesta (decidido el 19/10/2026).
    duraciones = [
        (t.atendido_en - t.tomado_en).total_seconds() / 60 for t in atendidos if t.tomado_en
    ]
    esperas = [
        (t.respondido_en - t.en_cola_desde).total_seconds() / 60
        for t in tickets
        if t.respondido_en and t.en_cola_desde
    ]
    nombres = etiquetas.de_la_empresa()
    horas = HorasFueraDeHorario.objects.filter(
        ticket__in=[t.pk for t in tickets], estado=HorasFueraDeHorario.Estado.APROBADO
    ).aggregate(total=Sum("horas"))["total"] or Decimal("0")

    def contar(clave, opciones):
        return [
            {"etiqueta": etiqueta, "valor": sum(1 for t in tickets if clave(t) == valor)}
            for valor, etiqueta in opciones
        ]

    categorias = sorted({t.categoria.nombre for t in tickets})

    def area_de(ticket):
        return ticket.area.nombre if ticket.area_id else "Sin área"

    areas = sorted({area_de(t) for t in tickets})
    por_tecnico = {}
    for ticket in atendidos:
        if not ticket.tecnico_id:
            continue
        fila = por_tecnico.setdefault(
            str(ticket.tecnico), {"atendidos": 0, "en_plazo": 0, "medidos": 0}
        )
        fila["atendidos"] += 1
        cumplio = _cumplio(ticket)
        if cumplio is not None:
            fila["medidos"] += 1
            fila["en_plazo"] += int(cumplio)

    return {
        "kpis": {
            "creados": len(tickets),
            "en_cola": sum(1 for t in tickets if t.estado == Estado.NUEVO),
            "en_atencion": sum(
                1
                for t in tickets
                if t.estado in (Estado.ASIGNADO, Estado.EN_CURSO, Estado.ESPERANDO_USUARIO)
            ),
            "atendidos": len(atendidos),
            "cumplimiento_sla": _porcentaje(sum(medidos), len(medidos)),
            "meta_sla": configuracion.meta_sla,
            "cumplimiento_respuesta": _porcentaje(sum(respuestas), len(respuestas)),
            "fcr": _porcentaje(len(en_primer_contacto), len(atendidos)),
            "reabiertos": _porcentaje(sum(1 for t in atendidos if t.reaperturas), len(atendidos)),
            "csat": (
                round(sum(e.calificacion for e in encuestas) / len(encuestas), 1)
                if encuestas
                else None
            ),
            "respuesta_encuesta": _porcentaje(len(encuestas), len(atendidos)),
            "canal_oficial": _porcentaje(
                sum(1 for t in tickets if t.canal == Canal.PORTAL), len(tickets)
            ),
            "minutos_promedio": round(sum(duraciones) / len(duraciones)) if duraciones else None,
            "lead_time_promedio": round(sum(esperas) / len(esperas)) if esperas else None,
            "escalados_sla": sum(1 for t in tickets if t.escalado_por_sla),
            "fuera_de_horario": sum(1 for t in tickets if t.fuera_de_horario),
            "horas_fuera_aprobadas": str(horas),
        },
        "prioridades": [
            {
                "prioridad": valor,
                "etiqueta": nombres["prioridades"][valor],
                "tickets": sum(1 for t in tickets if t.prioridad == valor),
                "cumplimiento": _porcentaje(
                    sum(1 for t in atendidos if t.prioridad == valor and _cumplio(t)),
                    sum(1 for t in atendidos if t.prioridad == valor and _cumplio(t) is not None),
                ),
                "meta": (
                    configuracion.meta_sla_critica
                    if valor == Prioridad.CRITICA
                    else configuracion.meta_sla
                ),
            }
            for valor in Prioridad.values
        ],
        "graficos": [
            {
                "clave": "canal",
                "titulo": "Tickets por canal",
                "filas": contar(lambda t: t.canal, Canal.choices),
            },
            {
                "clave": "tipo",
                "titulo": "Tickets por tipo",
                "filas": contar(lambda t: t.tipo, TipoTicket.choices),
            },
            {
                "clave": "estado",
                "titulo": "Tickets por estado",
                "filas": contar(lambda t: t.estado, list(nombres["estados"].items())),
            },
            {
                "clave": "categoria",
                "titulo": "Tickets por categoría",
                "filas": [
                    {"etiqueta": c, "valor": sum(1 for t in tickets if t.categoria.nombre == c)}
                    for c in categorias
                ],
            },
            {
                "clave": "area",
                "titulo": "Tickets por área solicitante",
                "filas": [
                    {"etiqueta": a, "valor": sum(1 for t in tickets if area_de(t) == a)}
                    for a in areas
                ],
            },
        ],
        "tecnicos": [
            {
                "tecnico": nombre,
                "atendidos": fila["atendidos"],
                "cumplimiento_sla": (
                    round(100 * fila["en_plazo"] / fila["medidos"], 1) if fila["medidos"] else None
                ),
            }
            for nombre, fila in sorted(por_tecnico.items())
        ],
    }
