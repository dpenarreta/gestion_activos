"""Indicadores del dashboard principal (§15 del documento funcional).

Los diez indicadores del documento se calculan aquí en agregaciones sobre la
base, no recorriendo los activos en Python: con las 5.000 a 10.000 filas que el
documento dimensiona, traerse el inventario para contarlo sería la diferencia
entre una consulta y varios megabytes por cada carga del panel.

Uno de los diez queda fuera: «garantías vencidas» necesita una fecha de
garantía que el sistema todavía no tiene (ver `docs/funcional/analisis-de-brecha.md`).
Se omite en vez de devolver un cero, que se leería como «ninguna vencida».
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from apps.mantenimientos.models import ComponenteUtilizado, Mantenimiento
from apps.politicas.services import evaluar_activo, resolver_politica

from .models import Activo

MESES_TENDENCIA = 6
TOP_EQUIPOS_REPARADOS = 5


def _conteos_por_estado() -> dict:
    """Una sola consulta para los cinco indicadores de estado."""
    filas = Activo.objects.values("estado").annotate(total=Count("id"))
    return {fila["estado"]: fila["total"] for fila in filas}


def _costo_de_reparaciones(desde=None) -> Decimal:
    """Mano de obra más repuestos, opcionalmente desde una fecha."""
    mantenimientos = Mantenimiento.objects.all()
    componentes = ComponenteUtilizado.objects.all()
    if desde is not None:
        mantenimientos = mantenimientos.filter(fecha_intervencion__gte=desde)
        componentes = componentes.filter(mantenimiento__fecha_intervencion__gte=desde)

    mano_obra = mantenimientos.aggregate(total=Sum("costo_mano_obra"))["total"] or Decimal("0")
    repuestos = componentes.aggregate(total=Sum(F("cantidad") * F("costo_unitario")))[
        "total"
    ] or Decimal("0")
    return mano_obra + repuestos


def _equipos_mas_reparados() -> list[dict]:
    """Ranking de activos problemáticos (§15).

    Se ordena por el contador desnormalizado del activo, no por un `COUNT` sobre
    la bitácora: es el mismo número y evita el join.
    """
    activos = (
        Activo.objects.filter(total_mantenimientos__gt=0)
        .exclude(estado=Activo.Estado.DADO_DE_BAJA)
        .select_related("tipo", "departamento")
        .order_by("-total_mantenimientos", "codigo_barras")[:TOP_EQUIPOS_REPARADOS]
    )
    return [
        {
            "id": activo.id,
            "codigo_barras": activo.codigo_barras,
            "nombre": activo.nombre,
            "tipo": activo.tipo.nombre,
            "departamento": activo.departamento.nombre,
            "total_mantenimientos": activo.total_mantenimientos,
            "total_componentes_criticos": activo.total_componentes_criticos,
        }
        for activo in activos
    ]


def _reparaciones_por_mes() -> list[dict]:
    """Volumen de los últimos meses, para ver la tendencia y no solo el mes
    actual (un número suelto no dice si sube o baja)."""
    hoy = timezone.localdate()
    # Primer día del mes, MESES_TENDENCIA - 1 meses atrás.
    mes = hoy.month - (MESES_TENDENCIA - 1)
    anio = hoy.year
    while mes <= 0:
        mes += 12
        anio -= 1
    desde = hoy.replace(year=anio, month=mes, day=1)

    filas = (
        Mantenimiento.objects.filter(fecha_intervencion__gte=desde)
        .annotate(mes=TruncMonth("fecha_intervencion"))
        .values("mes")
        .annotate(total=Count("id"))
        .order_by("mes")
    )
    return [{"mes": fila["mes"].isoformat(), "total": fila["total"]} for fila in filas]


def _con_sugerencia_de_renovacion() -> int:
    """Activos que hoy exceden algún umbral.

    Se recalcula en vivo y no se filtra por la columna cacheada porque el
    criterio de longevidad se cumple por el paso del tiempo: la caché puede
    estar desactualizada justo para los casos que interesan (ver
    `apps.politicas.services`).
    """
    politicas: dict[int, object] = {}
    total = 0
    for activo in (
        Activo.objects.exclude(estado=Activo.Estado.DADO_DE_BAJA)
        .select_related("tipo")
        .only(
            "id",
            "estado",
            "fecha_adquisicion",
            "total_mantenimientos",
            "total_componentes_criticos",
            "tipo",
        )
    ):
        if activo.tipo_id not in politicas:
            politicas[activo.tipo_id] = resolver_politica(activo.tipo)
        if evaluar_activo(activo, politica=politicas[activo.tipo_id]).requiere_renovacion:
            total += 1
    return total


def construir_indicadores() -> dict:
    """Los indicadores del dashboard principal."""
    por_estado = _conteos_por_estado()
    hoy = timezone.localdate()
    inicio_mes = hoy.replace(day=1)

    reparaciones_del_mes = Mantenimiento.objects.filter(fecha_intervencion__gte=inicio_mes).count()

    sin_asignar_hace_tiempo = Activo.objects.filter(
        estado=Activo.Estado.EN_BODEGA, updated_at__lt=timezone.now() - timedelta(days=90)
    ).count()

    return {
        "activos": {
            "total": sum(por_estado.values()),
            "en_uso": por_estado.get(Activo.Estado.EN_USO, 0),
            "en_bodega": por_estado.get(Activo.Estado.EN_BODEGA, 0),
            "en_mantenimiento": por_estado.get(Activo.Estado.EN_MANTENIMIENTO, 0),
            "dados_de_baja": por_estado.get(Activo.Estado.DADO_DE_BAJA, 0),
            "requieren_renovacion": _con_sugerencia_de_renovacion(),
            "sin_asignar_mas_de_90_dias": sin_asignar_hace_tiempo,
        },
        "mantenimientos": {
            "del_mes": reparaciones_del_mes,
            "total_historico": Mantenimiento.objects.count(),
            "costo_acumulado": _costo_de_reparaciones(),
            "costo_del_mes": _costo_de_reparaciones(desde=inicio_mes),
            "por_mes": _reparaciones_por_mes(),
            "por_tipo": dict(
                Mantenimiento.objects.values_list("tipo")
                .annotate(total=Count("id"))
                .values_list("tipo", "total")
            ),
        },
        "equipos_mas_reparados": _equipos_mas_reparados(),
        "por_tipo_dispositivo": list(
            Activo.objects.exclude(estado=Activo.Estado.DADO_DE_BAJA)
            .values(nombre_tipo=F("tipo__nombre"))
            .annotate(total=Count("id"))
            .order_by("-total")
        ),
        "por_departamento": list(
            Activo.objects.exclude(estado=Activo.Estado.DADO_DE_BAJA)
            .values(nombre_departamento=F("departamento__nombre"))
            .annotate(
                total=Count("id"),
                asignados=Count("id", filter=Q(estado=Activo.Estado.EN_USO)),
            )
            .order_by("-total")
        ),
        # Declarado explícitamente para que la interfaz pueda decir por qué
        # falta este indicador del documento, en vez de omitirlo en silencio.
        "indicadores_no_disponibles": [
            {
                "clave": "garantias_vencidas",
                "motivo": "El activo todavía no tiene campo de garantía.",
            }
        ],
    }
