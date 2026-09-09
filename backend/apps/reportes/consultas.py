"""Ejecuta un reporte del catálogo: arma el queryset y produce las filas.

Los parámetros llegan de la URL, así que se validan uno por uno y se ignoran
los que no vienen o vienen mal: un reporte que devuelve 400 porque alguien
escribió `desde=ayer` es más molesto que uno que devuelve el período completo.
Lo que **no** se ignora es un parámetro que el reporte no declara — ahí sí hay
un error de programación o un intento de filtrar por algo que no corresponde.
"""

import datetime

from django.db.models import Prefetch
from django.utils import timezone

from apps.activos.models import DIAS_AVISO_GARANTIA, Activo, MovimientoActivo
from apps.mantenimientos.models import ComponenteUtilizado, Mantenimiento
from apps.politicas.services import restar_meses

from .catalogo import MAX_FILAS, Fuente, Reporte


def _entero(valor) -> int | None:
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        return None
    return numero if numero >= 0 else None


def _fecha(valor) -> datetime.date | None:
    try:
        return datetime.date.fromisoformat(str(valor))
    except (TypeError, ValueError):
        return None


def _base_activos(reporte: Reporte):
    queryset = Activo.objects.select_related("tipo", "custodio", "departamento", "sede")
    if reporte.solo_operativos:
        queryset = queryset.operativos()
    return queryset


def _base_movimientos():
    return MovimientoActivo.objects.select_related(
        "activo", "custodio_anterior", "custodio_nuevo", "departamento_nuevo", "registrado_por"
    )


def _base_mantenimientos():
    # Los componentes se precargan porque `costo_total` los recorre: sin esto,
    # un reporte de 2.000 intervenciones haría 2.000 consultas extra.
    return Mantenimiento.objects.select_related("activo", "activo__departamento").prefetch_related(
        Prefetch("componentes", queryset=ComponenteUtilizado.objects.all())
    )


def _filtrar_activos(queryset, parametros: dict, reporte: Reporte):
    hoy = timezone.localdate()

    for clave, campo in (
        ("departamento", "departamento_id"),
        ("sede", "sede_id"),
        ("tipo", "tipo_id"),
        ("custodio", "custodio_id"),
    ):
        valor = _entero(parametros.get(clave))
        if valor is not None:
            queryset = queryset.filter(**{campo: valor})

    for clave, validos in (
        ("criticidad", {c.value for c in Activo.Criticidad}),
        ("uso", {u.value for u in Activo.Uso}),
    ):
        valor = parametros.get(clave)
        if valor in validos:
            queryset = queryset.filter(**{clave: valor})

    # Antigüedad: se traduce a fechas límite, con los operadores invertidos
    # respecto de lo que se lee (más viejo = adquirido antes).
    minimo = _entero(parametros.get("antiguedad_min_meses"))
    if minimo is not None:
        queryset = queryset.filter(fecha_adquisicion__lte=restar_meses(hoy, minimo))
    maximo = _entero(parametros.get("antiguedad_max_meses"))
    if maximo is not None:
        queryset = queryset.filter(fecha_adquisicion__gte=restar_meses(hoy, maximo))

    if reporte.clave == "garantias-por-vencer":
        dias = _entero(parametros.get("dias"))
        if dias is None:
            dias = DIAS_AVISO_GARANTIA
        queryset = queryset.filter(
            fecha_fin_garantia__gte=hoy,
            fecha_fin_garantia__lte=hoy + datetime.timedelta(days=dias),
        )

    return queryset


def _filtrar_por_fechas(queryset, parametros: dict, campo: str):
    desde = _fecha(parametros.get("desde"))
    if desde:
        queryset = queryset.filter(**{f"{campo}__gte": desde})
    hasta = _fecha(parametros.get("hasta"))
    if hasta:
        queryset = queryset.filter(**{f"{campo}__lte": hasta})
    return queryset


def construir_queryset(reporte: Reporte, parametros: dict):
    """Queryset ya filtrado y ordenado, sin evaluar."""
    if reporte.fuente == Fuente.ACTIVOS:
        queryset = _filtrar_activos(_base_activos(reporte), parametros, reporte)

    elif reporte.fuente == Fuente.MOVIMIENTOS:
        queryset = _base_movimientos()
        queryset = _filtrar_por_fechas(queryset, parametros, "created_at__date")
        activo = _entero(parametros.get("activo"))
        if activo is not None:
            queryset = queryset.filter(activo_id=activo)
        departamento = _entero(parametros.get("departamento"))
        if departamento is not None:
            queryset = queryset.filter(activo__departamento_id=departamento)
        custodio = _entero(parametros.get("custodio"))
        if custodio is not None:
            # Quien entregó y quien recibió: el historial de una persona son
            # sus dos lados, no solo aquello que le llegó.
            queryset = queryset.filter(custodio_anterior_id=custodio) | queryset.filter(
                custodio_nuevo_id=custodio
            )

    else:
        queryset = _base_mantenimientos()
        queryset = _filtrar_por_fechas(queryset, parametros, "fecha_intervencion")
        activo = _entero(parametros.get("activo"))
        if activo is not None:
            queryset = queryset.filter(activo_id=activo)
        departamento = _entero(parametros.get("departamento"))
        if departamento is not None:
            queryset = queryset.filter(activo__departamento_id=departamento)
        tipo = parametros.get("tipo_mantenimiento")
        if tipo in {t.value for t in Mantenimiento.Tipo}:
            queryset = queryset.filter(tipo=tipo)

    if reporte.filtros:
        queryset = queryset.filter(**reporte.filtros)
    if reporte.orden:
        queryset = queryset.order_by(*reporte.orden)
    return queryset


def generar_filas(reporte: Reporte, parametros: dict, *, formato: str = "xlsx") -> dict:
    """Filas ya extraídas, listas para cualquier renderizador.

    Devuelve también si hubo corte: un reporte truncado en silencio se lee
    como si el parque tuviera menos equipos de los que tiene.
    """
    from .catalogo import MAX_FILAS_PDF

    columnas = reporte.columnas_para(formato)
    tope = MAX_FILAS_PDF if formato == "pdf" else MAX_FILAS

    queryset = construir_queryset(reporte, parametros)
    total = queryset.count()
    objetos = list(queryset[:tope])

    filas = [[columna.valor(objeto) for columna in columnas] for objeto in objetos]

    totales = {}
    if reporte.totalizar:
        indices = {
            columna.clave: posicion
            for posicion, columna in enumerate(columnas)
            if columna.clave in reporte.totalizar
        }
        for posicion in indices.values():
            suma = sum(
                (fila[posicion] for fila in filas if isinstance(fila[posicion], (int, float))),
                start=0,
            )
            # Los Decimal se suman aparte para no mezclar tipos: en dinero, un
            # float acumulado da diferencias de centavos que nadie sabe
            # explicar frente al área financiera.
            decimales = [
                fila[posicion]
                for fila in filas
                if fila[posicion] is not None and not isinstance(fila[posicion], (int, float))
            ]
            if decimales:
                suma = sum(decimales, start=type(decimales[0])(0))
            totales[posicion] = suma

    return {
        "columnas": columnas,
        "filas": filas,
        "total": total,
        "truncado": total > len(filas),
        "tope": tope,
        "totales": totales,
    }
