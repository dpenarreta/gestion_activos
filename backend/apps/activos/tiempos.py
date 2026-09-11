"""Los siete tiempos del §10 del documento funcional.

Cuatro de ellos no salen de la ficha sino del **historial**: el sistema nunca
guardó «cuánto tiempo lleva este equipo con quien responde por él», guardó cada
movimiento con su fecha, y de ahí se reconstruye. Esa es la razón de que el
historial sea append-only y de que cada cambio de estado deje su fila: sin eso
estos números no existirían, y guardarlos como contadores obligaría a
mantenerlos al día en cada operación, con el riesgo de que se desincronizaran
justo en los equipos que más se mueven.

Se calculan al vuelo y solo en la ficha de un activo. En el listado no
aparecen a propósito: exigen recorrer los movimientos de cada equipo, y hacerlo
para veinte filas por página multiplicaría las consultas por veinte (ver
`docs/rendimiento.md`).
"""

import datetime

from django.utils import timezone

from .models import ESTADOS_EN_ALMACEN, ESTADOS_FUERA_DE_INVENTARIO, MovimientoActivo


def _dias_desde(fecha) -> int | None:
    if fecha is None:
        return None
    if isinstance(fecha, datetime.datetime):
        fecha = timezone.localtime(fecha).date()
    return max((timezone.localdate() - fecha).days, 0)


def _tramos_de_estado(activo, movimientos) -> list[tuple[str, datetime.date, datetime.date]]:
    """Reconstruye en qué estado estuvo el equipo y entre qué fechas.

    Cada tramo es `(estado, desde, hasta)`. El último llega hasta hoy, salvo
    que el equipo haya salido del inventario: a partir de ahí ya no acumula
    tiempo de nada, porque no está.
    """
    con_estado = [m for m in movimientos if m.estado_nuevo]
    if not con_estado:
        return []

    hoy = timezone.localdate()
    tramos = []
    for indice, movimiento in enumerate(con_estado):
        desde = timezone.localtime(movimiento.created_at).date()
        if indice + 1 < len(con_estado):
            hasta = timezone.localtime(con_estado[indice + 1].created_at).date()
        else:
            hasta = hoy
        if movimiento.estado_nuevo in ESTADOS_FUERA_DE_INVENTARIO:
            # Salió del parque: el tramo se cierra ahí y no sigue corriendo.
            hasta = desde
        tramos.append((movimiento.estado_nuevo, desde, hasta))
    return tramos


def calcular(activo) -> dict:
    """Los siete tiempos, en días.

    Espera que `movimientos` y `mantenimientos` estén precargados; si no lo
    están, los pedirá aquí y hará dos consultas más.
    """
    movimientos = sorted(activo.movimientos.all(), key=lambda m: m.created_at)
    mantenimientos = list(activo.mantenimientos.all())
    hoy = timezone.localdate()

    # --- Los dos que salen de la ficha ---
    desde_compra = _dias_desde(activo.fecha_adquisicion)
    desde_ingreso = _dias_desde(activo.fecha_ingreso)

    # --- Los dos que salen del historial de custodia ---
    asignaciones = [m for m in movimientos if m.tipo == MovimientoActivo.Tipo.ASIGNACION]
    desde_primera_asignacion = _dias_desde(asignaciones[0].created_at) if asignaciones else None

    # Con varios responsables se toma **el que lleva más tiempo**: la
    # pregunta que este número responde es desde cuándo el equipo está en manos
    # de quienes lo tienen hoy, y con el más reciente un equipo entregado hace
    # dos años parecería recién asignado cada vez que se suma alguien al turno.
    # Con un solo responsable da exactamente lo mismo que antes.
    con_custodio_actual = None
    for empleado in activo.responsables.all():
        # La última entrega **a esta persona** sin devolución posterior: si se
        # tomara la primera, un equipo devuelto y reentregado al mismo
        # empleado sumaría el tiempo en que no lo tuvo.
        for movimiento in reversed(movimientos):
            if movimiento.custodio_nuevo_id == empleado.id:
                dias = _dias_desde(movimiento.created_at)
                if dias is not None and (con_custodio_actual is None or dias > con_custodio_actual):
                    con_custodio_actual = dias
                break
            if movimiento.custodio_anterior_id == empleado.id:
                break

    # --- Reparación ---
    # Se separan el tiempo cerrado y el que corre ahora: sumarlos escondería
    # que el equipo todavía está fuera, que es lo que hay que ver.
    en_reparacion = sum(
        m.dias_fuera_de_operacion or 0 for m in mantenimientos if m.fecha_salida is not None
    )
    abiertas = [m for m in mantenimientos if m.fecha_salida is None]
    en_reparacion_ahora = (
        max((hoy - min(m.fecha_intervencion for m in abiertas)).days, 0) if abiertas else 0
    )

    # --- Almacén: lo que estuvo guardado sin que nadie lo usara ---
    tramos = _tramos_de_estado(activo, movimientos)
    sin_uso = sum(
        (hasta - desde).days for estado, desde, hasta in tramos if estado in ESTADOS_EN_ALMACEN
    )

    # --- Tiempo activo real ---
    # Lo que el equipo estuvo efectivamente trabajando: su vida en la empresa
    # menos lo que pasó guardado y lo que pasó en el taller. Se cuenta desde el
    # ingreso cuando se conoce, y desde la compra cuando no: un equipo comprado
    # en diciembre que entró en marzo no estuvo trabajando esos tres meses.
    base = desde_ingreso if desde_ingreso is not None else desde_compra
    activo_real = None
    if base is not None:
        activo_real = max(base - sin_uso - en_reparacion - en_reparacion_ahora, 0)

    return {
        "desde_compra_dias": desde_compra,
        "desde_ingreso_dias": desde_ingreso,
        "desde_primera_asignacion_dias": desde_primera_asignacion,
        "con_custodio_actual_dias": con_custodio_actual,
        "en_reparacion_dias": en_reparacion,
        "en_reparacion_ahora_dias": en_reparacion_ahora,
        "sin_uso_dias": sin_uso,
        "activo_real_dias": activo_real,
        # La base del cálculo se declara porque cambia el significado: un
        # «tiempo activo real» medido desde la compra y otro desde el ingreso
        # no son comparables entre equipos.
        "medido_desde": "ingreso" if desde_ingreso is not None else "compra",
    }
