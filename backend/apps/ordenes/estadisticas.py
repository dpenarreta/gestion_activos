"""Indicadores, «requieren atención» y gráficos de las órdenes de trabajo.

Se calculan sobre las órdenes que la persona puede ver: el técnico ve los
números de lo suyo y el coordinador los de toda la empresa. Es la misma regla
que el listado, para que el panel nunca cuente algo que la lista no muestra.
"""

import datetime
from decimal import Decimal

from django.utils import timezone

from apps.organizacion.models import Sede

from .models import MovimientoOrden, OrdenTrabajo

Estado = OrdenTrabajo.Estado
Prioridad = OrdenTrabajo.Prioridad


def filtrar(queryset, parametros):
    """Periodo (`AAAA` o `AAAA-MM`, por fecha de solicitud), región, categoría
    y sede: los filtros de la reportería."""
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
    region = parametros.get("region")
    if region in Sede.Region.values:
        queryset = queryset.filter(sede__region=region)
    categoria = parametros.get("categoria")
    if categoria in OrdenTrabajo.Categoria.values:
        queryset = queryset.filter(categoria=categoria)
    sede = parametros.get("sede")
    if sede and str(sede).isdigit():
        queryset = queryset.filter(sede_id=int(sede))
    return queryset


def _con_relaciones(queryset):
    return queryset.select_related("sede", "solicitante", "tecnico", "proveedor").prefetch_related(
        "materiales", "mano_de_obra"
    )


def resumen(queryset) -> dict:
    hoy = timezone.localdate()
    ordenes = list(_con_relaciones(queryset))
    abiertas = [o for o in ordenes if not o.esta_cerrada]
    vencidas = [o for o in abiertas if o.cumplimiento(hoy) == "vencida"]
    costo = sum((o.costos()["total"] for o in ordenes), Decimal("0"))
    kpis = {
        "registradas": len(ordenes),
        "abiertas": len(abiertas),
        "vencidas": len(vencidas),
        "cerradas": len(ordenes) - len(abiertas),
        "costo_total": str(costo),
        "prioridad_alta": sum(
            1 for o in ordenes if o.prioridad in {Prioridad.CRITICA, Prioridad.ALTA}
        ),
        "pendientes_aprobacion": sum(1 for o in ordenes if o.estado == Estado.PENDIENTE_APROBACION),
        "con_observaciones": sum(1 for o in ordenes if o.con_observaciones),
    }
    atencion = [
        o
        for o in abiertas
        if o.cumplimiento(hoy) == "vencida" or o.prioridad in {Prioridad.CRITICA, Prioridad.ALTA}
    ]
    orden_prioridad = list(Prioridad.values)
    atencion.sort(key=lambda o: (orden_prioridad.index(o.prioridad), o.fecha_programada or hoy))
    return {"kpis": kpis, "atencion": atencion, "ordenes": ordenes}


def graficos(ordenes) -> list[dict]:
    def contar(clave, opciones):
        return [
            {"etiqueta": etiqueta, "valor": sum(1 for o in ordenes if clave(o) == valor)}
            for valor, etiqueta in opciones
        ]

    costo_por_categoria = []
    for valor, etiqueta in OrdenTrabajo.Categoria.choices:
        total = sum((o.costos()["total"] for o in ordenes if o.categoria == valor), Decimal("0"))
        costo_por_categoria.append({"etiqueta": etiqueta, "valor": str(total)})
    costo_por_categoria.sort(key=lambda fila: Decimal(fila["valor"]), reverse=True)

    return [
        {
            "clave": "estado",
            "titulo": "Órdenes por estado",
            "filas": contar(lambda o: o.estado, Estado.choices),
        },
        {
            "clave": "region",
            "titulo": "Órdenes por región",
            "filas": contar(lambda o: o.sede.region, Sede.Region.choices),
        },
        {
            "clave": "prioridad",
            "titulo": "Órdenes por prioridad",
            "filas": contar(lambda o: o.prioridad, Prioridad.choices),
        },
        {
            "clave": "costo_categoria",
            "titulo": "Costo por categoría",
            "moneda": True,
            "filas": costo_por_categoria,
        },
    ]


def actividad_reciente(queryset, limite=8):
    return (
        MovimientoOrden.objects.filter(orden__in=queryset.values("pk"))
        .select_related("actor", "orden")
        .order_by("-created_at")[:limite]
    )
