"""Los plazos de un ticket: cuánto tiene para responder y para resolver.

Lo que manda el flujo ITIL de la empresa, con lo que decidió el dueño del
proceso el 19/10/2026:

- **Dos relojes**: el de respuesta (*lead time*) corre desde que se crea el
  ticket hasta la primera respuesta del equipo; el de solución (*cycle time*),
  desde que un técnico lo toma por primera vez hasta que se atiende.
- **Calendario por prioridad**: los P1 en horas calendario (las 24 h, si la
  mesa lo tiene así) y los demás en el horario hábil de la mesa, sin sus
  feriados.
- **Sin regalar tiempo**: escalar no reinicia el plazo de solución. Esperar
  al usuario y quedar atendido lo detienen, y al volver (o al reabrirse) sigue
  con lo que quedaba.
- **Prioridad por matriz**: impacto × urgencia, sobre la prioridad base del
  caso elegido; gana la más urgente de las dos.
"""

from datetime import time, timedelta

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from .horario import Agenda
from .models import ConfiguracionMesa, FeriadoMesa, HorarioMesa, Prioridad, ReglaSLA, Ticket

Estado = Ticket.Estado

#: Respuesta y solución en minutos por prioridad, cuando ninguna regla de la
#: empresa dice otra cosa (§6.5 del flujo: 15 min / 4 h para P1, etc.).
PLAZOS_POR_DEFECTO = {
    Prioridad.CRITICA: (15, 4 * 60),
    Prioridad.ALTA: (30, 8 * 60),
    Prioridad.MEDIA: (2 * 60, 16 * 60),
    Prioridad.BAJA: (4 * 60, 40 * 60),
}

#: El horario hábil si la mesa no configuró el suyo: lunes a viernes, 08:00 a 17:30.
HORARIO_POR_DEFECTO = [(dia, time(8, 0), time(17, 30)) for dia in range(5)]

#: Proporción del plazo en que se avisa antes de vencer.
PROPORCION_ALERTA = 0.8

#: Los estados en que el reloj de solución corre.
CORRE = (Estado.NUEVO, Estado.ASIGNADO, Estado.EN_CURSO)

#: Impacto × urgencia → prioridad (§6.5).
MATRIZ = {
    ("alto", "alta"): Prioridad.CRITICA,
    ("alto", "media"): Prioridad.ALTA,
    ("alto", "baja"): Prioridad.MEDIA,
    ("medio", "alta"): Prioridad.ALTA,
    ("medio", "media"): Prioridad.MEDIA,
    ("medio", "baja"): Prioridad.BAJA,
    ("bajo", "alta"): Prioridad.MEDIA,
    ("bajo", "media"): Prioridad.BAJA,
    ("bajo", "baja"): Prioridad.BAJA,
}

#: 1 es lo más urgente.
RANGO = {Prioridad.CRITICA: 1, Prioridad.ALTA: 2, Prioridad.MEDIA: 3, Prioridad.BAJA: 4}


def prioridad_por_matriz(impacto, urgencia):
    return MATRIZ.get((impacto or "", urgencia or ""))


def prioridad_inicial(base, impacto, urgencia):
    """La más urgente entre la del caso y la de la matriz (si se respondió)."""
    por_matriz = prioridad_por_matriz(impacto, urgencia)
    if por_matriz and RANGO[por_matriz] < RANGO[base]:
        return por_matriz
    return base


# --- Calendarios -----------------------------------------------------------------------


def _empresa_id(ticket):
    """La del ticket; la activa si todavía no se guardó (al crearlo)."""
    if ticket.empresa_id:
        return ticket.empresa_id
    actual = empresa_actual()
    return None if actual in (None, SIN_EMPRESA) else actual.id


def configuracion(empresa_id) -> ConfiguracionMesa:
    """La configuración de la mesa, o una sin guardar con los valores por defecto."""
    return ConfiguracionMesa.objects.todas().filter(
        empresa_id=empresa_id
    ).first() or ConfiguracionMesa(empresa_id=empresa_id)


def calendario_de_la_mesa(empresa_id) -> Agenda:
    franjas = [
        (h.dia_semana, h.hora_inicio, h.hora_fin)
        for h in HorarioMesa.objects.todas().filter(empresa_id=empresa_id)
    ] or HORARIO_POR_DEFECTO
    feriados = [
        (f.desde, f.hasta) for f in FeriadoMesa.objects.todas().filter(empresa_id=empresa_id)
    ]
    return Agenda.de_franjas(franjas, feriados)


def calendario(ticket) -> Agenda:
    """Las 24 h para un P1 (si la mesa lo tiene así); el horario hábil, si no."""
    if ticket.prioridad == Prioridad.CRITICA and configuracion(_empresa_id(ticket)).critica_24x7:
        return Agenda.continua()
    return calendario_de_la_mesa(_empresa_id(ticket))


def dias_habiles_entre(empresa_id, desde, hasta) -> int:
    """Días hábiles de la mesa transcurridos después de `desde` hasta `hasta`."""
    agenda = calendario_de_la_mesa(empresa_id)
    dia, ultimo, dias = desde.date() + timedelta(days=1), hasta.date(), 0
    while dia <= ultimo:
        dias += agenda.es_habil(dia)
        dia += timedelta(days=1)
    return dias


# --- Plazos ----------------------------------------------------------------------------


def regla(ticket):
    """La regla más específica que coincide con el ticket (o `None`)."""
    mejor, puntos_mejor = None, -1
    # Por la empresa del ticket y no la activa: la tarea programada corre sin
    # empresa y vería las reglas de todas.
    for candidata in ReglaSLA.objects.todas().filter(empresa_id=_empresa_id(ticket)):
        if candidata.categoria_id and candidata.categoria_id != ticket.categoria_id:
            continue
        if candidata.area_id and candidata.area_id != ticket.area_id:
            continue
        if candidata.prioridad and candidata.prioridad != ticket.prioridad:
            continue
        puntos = (
            bool(candidata.categoria_id) * 4
            + bool(candidata.area_id) * 2
            + bool(candidata.prioridad)
        )
        if puntos > puntos_mejor:
            mejor, puntos_mejor = candidata, puntos
    return mejor


def plazos(ticket) -> tuple[int, int]:
    """(respuesta, solución) en minutos. El plazo propio del caso gana sobre las
    reglas; las reglas, sobre los de su prioridad."""
    respuesta, solucion = PLAZOS_POR_DEFECTO[ticket.prioridad]
    elegida = regla(ticket)
    if elegida:
        solucion = elegida.minutos
        respuesta = elegida.minutos_respuesta or respuesta
    if ticket.caso_id and ticket.caso.minutos_plazo:
        solucion = ticket.caso.minutos_plazo
    return respuesta, solucion


def programar(ticket, agenda: Agenda, desde, minutos_restantes: int):
    """El vencimiento de la solución y el momento del aviso, desde `desde`."""
    ticket.sla_vence = agenda.sumar_minutos(desde, minutos_restantes)
    margen = int(ticket.sla_minutos * (1 - PROPORCION_ALERTA))
    antes_del_aviso = max(minutos_restantes - margen, 0)
    ticket.sla_alerta_en = (
        agenda.sumar_minutos(desde, antes_del_aviso) if antes_del_aviso else desde
    )


def iniciar(ticket, desde):
    """Al entrar a la cola: corre el plazo de respuesta y queda fijado (sin
    correr todavía) el de solución, que arranca al tomarlo."""
    respuesta, solucion = plazos(ticket)
    ticket.sla_respuesta_minutos = respuesta
    ticket.sla_respuesta_vence = calendario(ticket).sumar_minutos(desde, respuesta)
    ticket.sla_minutos = solucion


def solucion_iniciada(ticket) -> bool:
    return ticket.sla_vence is not None or ticket.sla_restante_al_pausar is not None


def iniciar_solucion(ticket, desde):
    """Al tomarlo por primera vez: arranca el reloj de solución."""
    if not ticket.sla_minutos:
        ticket.sla_minutos = plazos(ticket)[1]
    programar(ticket, calendario(ticket), desde, ticket.sla_minutos)


def restante(ticket, ahora, agenda=None):
    """Minutos de solución que le quedan (`None` si no tiene plazo)."""
    if ticket.estado in CORRE:
        if not ticket.sla_vence:
            return None
        return (agenda or calendario(ticket)).minutos_entre(ahora, ticket.sla_vence)
    return ticket.sla_restante_al_pausar


def al_cambiar_de_estado(ticket, anterior, nuevo, ahora):
    """Detiene o reanuda el reloj, y anota la primera respuesta y el
    cumplimiento al atender. Modifica el ticket; lo guarda quien llama."""
    corria, corre = anterior in CORRE, nuevo in CORRE
    if nuevo == Estado.ATENDIDO:
        if corria:
            ticket.sla_cumplido = ticket.sla_vence is None or ahora <= ticket.sla_vence
        else:
            pendiente = ticket.sla_restante_al_pausar
            ticket.sla_cumplido = pendiente is None or pendiente > 0
    if corria and not corre and ticket.sla_vence:
        ticket.sla_restante_al_pausar = calendario(ticket).minutos_entre(ahora, ticket.sla_vence)
    if not corria and corre and ticket.sla_restante_al_pausar is not None:
        programar(ticket, calendario(ticket), ahora, ticket.sla_restante_al_pausar)
        ticket.sla_restante_al_pausar = None
        # Lo ya avisado no se repite; lo que todavía no venció vuelve a vigilarse.
        if ticket.sla_vence and ticket.sla_vence > ahora:
            ticket.sla_vencido_notificado = False
        if ticket.sla_alerta_en and ticket.sla_alerta_en > ahora:
            ticket.sla_alerta_enviada = False
    if ticket.respondido_en is None and nuevo not in (Estado.NUEVO, Estado.ASIGNADO):
        ticket.respondido_en = ahora
    if nuevo in CORRE and anterior == Estado.ATENDIDO:
        ticket.sla_cumplido = None


def recalcular_por_prioridad(ticket, prioridad_nueva, ahora):
    """Cambia la prioridad conservando lo ya consumido del plazo de solución."""
    if not solucion_iniciada(ticket):
        # Nadie lo tomó todavía: solo cambia lo que tendrá al tomarlo.
        ticket.prioridad = prioridad_nueva
        respuesta, solucion = plazos(ticket)
        ticket.sla_minutos = solucion
        if ticket.respondido_en is None:
            ticket.sla_respuesta_minutos = respuesta
            ticket.sla_respuesta_vence = calendario(ticket).sumar_minutos(
                ticket.en_cola_desde, respuesta
            )
            ticket.sla_respuesta_vencida_notificada = bool(
                ticket.sla_respuesta_vence and ticket.sla_respuesta_vence <= ahora
            )
        return
    pendiente = restante(ticket, ahora)
    consumido = ticket.sla_minutos - pendiente if pendiente is not None else 0
    ticket.prioridad = prioridad_nueva
    respuesta, solucion = plazos(ticket)
    agenda = calendario(ticket)
    ticket.sla_minutos = solucion
    nuevo_restante = max(solucion - consumido, 0)
    if ticket.estado in CORRE:
        programar(ticket, agenda, ahora, nuevo_restante)
        ticket.sla_alerta_enviada = bool(ticket.sla_alerta_en and ticket.sla_alerta_en <= ahora)
        ticket.sla_vencido_notificado = bool(ticket.sla_vence and ticket.sla_vence <= ahora)
    else:
        ticket.sla_restante_al_pausar = nuevo_restante
    if ticket.respondido_en is None:
        ticket.sla_respuesta_minutos = respuesta
        ticket.sla_respuesta_vence = agenda.sumar_minutos(ticket.en_cola_desde, respuesta)
        ticket.sla_respuesta_vencida_notificada = bool(
            ticket.sla_respuesta_vence and ticket.sla_respuesta_vence <= ahora
        )


def estado_de_la_respuesta(ticket, ahora) -> str:
    """cumplida, incumplida, vencida, en_plazo o sin_plazo."""
    if ticket.respondido_en:
        if not ticket.sla_respuesta_vence:
            return "cumplida"
        return "cumplida" if ticket.respondido_en <= ticket.sla_respuesta_vence else "incumplida"
    if not ticket.sla_respuesta_vence:
        return "sin_plazo"
    return "vencida" if ahora >= ticket.sla_respuesta_vence else "en_plazo"
