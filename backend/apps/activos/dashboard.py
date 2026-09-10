"""Indicadores del dashboard principal (§15 del documento funcional).

Los diez indicadores del documento se calculan aquí en agregaciones sobre la
base, no recorriendo los activos en Python: con las 5.000 a 10.000 filas que el
documento dimensiona, traerse el inventario para contarlo sería la diferencia
entre una consulta y varios megabytes por cada carga del panel.

Cualquier indicador que no se pueda calcular se declara en
`indicadores_no_disponibles` con su motivo, en vez de devolver un cero: un cero
en «garantías vencidas» se leería como «ninguna vencida», que es lo contrario
de «no lo sabemos».
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from apps.mantenimientos.models import ComponenteUtilizado, Mantenimiento
from apps.politicas.services import candidatos_a_renovacion, evaluar_lote

from .models import (
    DIAS_AVISO_GARANTIA,
    ESTADOS_EN_ALMACEN,
    ESTADOS_FUERA_DE_INVENTARIO,
    Activo,
)

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
        .operativos()
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


def _sugerencias_de_renovacion() -> dict:
    """Activos que hoy exceden algún umbral, desglosados por nivel (§11).

    Se recalcula en vivo y no se filtra por la columna cacheada porque el
    criterio de longevidad se cumple por el paso del tiempo: la caché puede
    estar desactualizada justo para los casos que interesan (ver
    `apps.politicas.services`).
    """
    activos = (
        Activo.objects.operativos()
        .select_related("tipo")
        .only(
            "id",
            "estado",
            "fecha_adquisicion",
            "total_mantenimientos",
            "total_componentes_criticos",
            "tipo",
        )
    )
    # Se prefiltra en SQL: traer el parque entero para descartar el 95 % es lo
    # que hacía que este panel tardara dos segundos con 10.000 activos.
    candidatos, politicas = candidatos_a_renovacion(activos)
    conteo = {"total": 0, "evaluar": 0, "recomendado": 0}
    for _activo, resultado in evaluar_lote(candidatos, politicas):
        if not resultado.requiere_renovacion:
            continue
        conteo["total"] += 1
        conteo[resultado.nivel] += 1
    return conteo


def _garantias() -> dict:
    """Cobertura del parque operativo.

    «Sin registrar» se cuenta aparte de «vencida»: no es lo mismo un equipo
    cuya cobertura expiró que uno del que nunca se capturó la fecha, y
    mezclarlos haría que un inventario a medio llenar pareciera un parque
    entero fuera de garantía.
    """
    hoy = timezone.localdate()
    limite_aviso = hoy + timedelta(days=DIAS_AVISO_GARANTIA)
    operativos = Activo.objects.operativos()

    return {
        "vencidas": operativos.filter(fecha_fin_garantia__lt=hoy).count(),
        "por_vencer": operativos.filter(
            fecha_fin_garantia__gte=hoy, fecha_fin_garantia__lte=limite_aviso
        ).count(),
        "vigentes": operativos.filter(fecha_fin_garantia__gt=limite_aviso).count(),
        "sin_registrar": operativos.filter(fecha_fin_garantia__isnull=True).count(),
        "dias_de_aviso": DIAS_AVISO_GARANTIA,
    }


def _dias_fuera_de_operacion() -> dict:
    """Tiempo que el parque estuvo sin poder usarse (§10).

    Solo suma las intervenciones cerradas: mientras no haya fecha de salida el
    equipo sigue fuera y ese tiempo aún no está determinado.
    """
    cerradas = Mantenimiento.objects.filter(fecha_salida__isnull=False)
    total = sum(
        (m.fecha_salida - m.fecha_intervencion).days
        for m in cerradas.only("fecha_intervencion", "fecha_salida")
    )
    return {
        "total_dias": total,
        "intervenciones_cerradas": cerradas.count(),
        "intervenciones_abiertas": Mantenimiento.objects.filter(fecha_salida__isnull=True).count(),
    }


def construir_indicadores() -> dict:
    """Los indicadores del dashboard principal."""
    por_estado = _conteos_por_estado()
    hoy = timezone.localdate()
    inicio_mes = hoy.replace(day=1)

    reparaciones_del_mes = Mantenimiento.objects.filter(fecha_intervencion__gte=inicio_mes).count()

    sin_asignar_hace_tiempo = Activo.objects.filter(
        estado__in=ESTADOS_EN_ALMACEN, updated_at__lt=timezone.now() - timedelta(days=90)
    ).count()

    renovacion = _sugerencias_de_renovacion()

    return {
        "activos": {
            "total": sum(por_estado.values()),
            "en_uso": por_estado.get(Activo.Estado.EN_USO, 0),
            "disponibles": por_estado.get(Activo.Estado.DISPONIBLE, 0),
            "en_bodega": por_estado.get(Activo.Estado.EN_BODEGA, 0),
            "en_mantenimiento": por_estado.get(Activo.Estado.EN_MANTENIMIENTO, 0),
            "en_garantia": por_estado.get(Activo.Estado.EN_GARANTIA, 0),
            "en_transito": por_estado.get(Activo.Estado.EN_TRANSITO, 0),
            "dados_de_baja": por_estado.get(Activo.Estado.DADO_DE_BAJA, 0),
            # Perdidos y robados van juntos y aparte de la baja: los tres
            # equipos ya no están, pero una baja es una decisión de la empresa
            # y las otras dos son pérdidas que alguien tiene que investigar.
            # Sumarlos a «dados de baja» escondería exactamente eso.
            "perdidos": por_estado.get(Activo.Estado.PERDIDO, 0),
            "robados": por_estado.get(Activo.Estado.ROBADO, 0),
            "operativos": sum(
                total
                for estado, total in por_estado.items()
                if estado not in ESTADOS_FUERA_DE_INVENTARIO
            ),
            "requieren_renovacion": renovacion["total"],
            "evaluar_reemplazo": renovacion["evaluar"],
            "reemplazo_recomendado": renovacion["recomendado"],
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
        "garantias": _garantias(),
        "fuera_de_operacion": _dias_fuera_de_operacion(),
        "equipos_mas_reparados": _equipos_mas_reparados(),
        "por_tipo_dispositivo": list(
            Activo.objects.operativos()
            .values(nombre_tipo=F("tipo__nombre"))
            .annotate(total=Count("id"))
            .order_by("-total")
        ),
        "por_departamento": list(
            Activo.objects.operativos()
            .values(nombre_departamento=F("departamento__nombre"))
            .annotate(
                total=Count("id"),
                asignados=Count("id", filter=Q(estado=Activo.Estado.EN_USO)),
            )
            .order_by("-total")
        ),
        # Los diez indicadores del §15 ya se calculan. La clave se conserva
        # para que la interfaz siga sabiendo tratar el caso, y para poder
        # declarar aquí cualquier indicador futuro que no sea posible todavía.
        "indicadores_no_disponibles": [],
    }
