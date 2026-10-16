"""Indicadores de la Mesa de ayuda para Reportes → Mesa de ayuda."""

import datetime
from decimal import Decimal

from django.db.models import Sum

from .models import HorasFueraDeHorario, Ticket

Estado = Ticket.Estado


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
    if not ticket.sla_vence or not ticket.atendido_en:
        return None
    return ticket.atendido_en <= ticket.sla_vence


def resumen(queryset) -> dict:
    tickets = list(queryset.select_related("categoria", "area", "tecnico__usuario"))
    atendidos = [t for t in tickets if t.atendido_en]
    medidos = [c for c in (_cumplio(t) for t in atendidos) if c is not None]
    duraciones = [
        (t.atendido_en - t.tomado_en).total_seconds() / 60 for t in atendidos if t.tomado_en
    ]
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
            "cumplimiento_sla": round(100 * sum(medidos) / len(medidos), 1) if medidos else None,
            "minutos_promedio": round(sum(duraciones) / len(duraciones)) if duraciones else None,
            "escalados_sla": sum(1 for t in tickets if t.escalado_por_sla),
            "fuera_de_horario": sum(1 for t in tickets if t.fuera_de_horario),
            "horas_fuera_aprobadas": str(horas),
        },
        "graficos": [
            {
                "clave": "estado",
                "titulo": "Tickets por estado",
                "filas": contar(lambda t: t.estado, Estado.choices),
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
