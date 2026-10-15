"""La generación automática de los períodos siguientes (§11.3).

Para cada obligación recurrente activa de una empresa activa, mientras su
último período venza dentro de los próximos `PERIOD_GENERATION_LEAD_DAYS`
días, crea el siguiente. Corre en el ciclo de la tarea programada, así que
tiene que ser **idempotente**: no crea un período si ya existe otro con la
misma etiqueta, y nunca más de `MAXIMO_POR_PASADA` por obligación —un
vencimiento mal escrito (año 2016 en vez de 2026) no debe sembrar cien
períodos de una vez—.
"""

import datetime
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import fechas
from .estados import zona_de
from .models import Obligacion, Periodicidad, Periodo
from .servicios import registrar_evento, siguiente_codigo

logger = logging.getLogger("apps.matriz")

MAXIMO_POR_PASADA = 24

#: Lo que el período nuevo hereda del último (§11.3).
HEREDADOS = ("responsable", "suplente", "supervisor", "aprobador", "prioridad", "sede")


def dias_de_anticipacion() -> int:
    return getattr(settings, "PERIOD_GENERATION_LEAD_DAYS", 30)


def _recurrentes():
    return (
        Obligacion.objects.todas()
        .filter(activa=True, empresa__activa=True)
        .exclude(periodicidad=Periodicidad.UNICA)
        .select_related("empresa")
    )


@transaction.atomic
def _crear_siguiente(obligacion, ultimo, vencimiento: datetime.date) -> Periodo | None:
    etiqueta = fechas.etiqueta(obligacion.periodicidad, vencimiento)
    if Periodo.objects.todas().filter(obligacion=obligacion, etiqueta=etiqueta).exists():
        return None
    zona = zona_de(obligacion.empresa)
    hora = ultimo.vence_en.astimezone(zona).time().replace(second=0, microsecond=0)
    inicio, preparacion = fechas.fechas_por_defecto(vencimiento)
    nuevo = Periodo.objects.create(
        empresa=obligacion.empresa,
        obligacion=obligacion,
        codigo=siguiente_codigo(),
        etiqueta=etiqueta,
        fecha_inicio=inicio,
        fecha_preparacion=preparacion,
        vence_en=fechas.instante(vencimiento, hora, zona),
        **{campo: getattr(ultimo, campo) for campo in HEREDADOS},
    )
    registrar_evento(nuevo, None, "period.created", "Registro del período generado")
    return nuevo


def generar_periodos(ahora=None) -> int:
    """Crea los períodos que tocan. Devuelve cuántos creó."""
    ahora = ahora or timezone.now()
    creados = 0
    for obligacion in _recurrentes():
        limite = ahora.astimezone(zona_de(obligacion.empresa)).date() + datetime.timedelta(
            days=dias_de_anticipacion()
        )
        for _ in range(MAXIMO_POR_PASADA):
            ultimo = (
                Periodo.objects.todas()
                .filter(obligacion=obligacion)
                .order_by("-vence_en", "-id")
                .first()
            )
            if ultimo is None:
                break
            dia_ultimo = ultimo.vence_en.astimezone(zona_de(obligacion.empresa)).date()
            if dia_ultimo > limite:
                break
            siguiente = fechas.siguiente_vencimiento(obligacion, dia_ultimo)
            if siguiente is None:
                break
            if _crear_siguiente(obligacion, ultimo, siguiente) is None:
                # La etiqueta ya existe (alguien lo creó a mano, o hay un hueco
                # raro en las fechas): no se insiste en esta pasada.
                break
            creados += 1
    if creados:
        logger.info("Matriz: %s período(s) generado(s).", creados)
    return creados
