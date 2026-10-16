"""Las reglas de la Mesa de ayuda: cola, reparto, estados, SLA y escalamiento.

Viven aquí y no en las vistas porque se usan desde varios caminos —el
formulario público, la bandeja del equipo y la tarea programada— y tienen que
decidir lo mismo en los tres.
"""

from datetime import timedelta

from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Min, Q
from django.utils import timezone

from apps.permissions.authorization import user_has_permission

from . import avisos
from .horario import Agenda
from .models import (
    AdjuntoTicket,
    HorasFueraDeHorario,
    MensajeTicket,
    MovimientoTicket,
    NivelSoporte,
    ReglaSLA,
    Tecnico,
    Ticket,
)

Estado = Ticket.Estado

#: Plazo cuando la empresa no configuró ninguna regla: una jornada.
SLA_POR_DEFECTO_MINUTOS = 480
#: Proporción del plazo en que se avisa antes de vencer.
PROPORCION_ALERTA = 0.8


def tiene(usuario, permiso: str) -> bool:
    return user_has_permission(usuario, f"soporte.{permiso}")


def tecnico_de(usuario):
    """El perfil de técnico de la persona en la empresa activa, si lo tiene."""
    if not getattr(usuario, "is_authenticated", False):
        return None
    return (
        Tecnico.objects.select_related("nivel")
        .prefetch_related("horarios", "ausencias", "categorias")
        .filter(usuario=usuario, activo=True)
        .first()
    )


def _movimiento(ticket, actor, descripcion, *, anterior="", nuevo="", nota=""):
    MovimientoTicket.objects.create(
        ticket=ticket,
        actor=actor,
        descripcion=descripcion[:255],
        estado_anterior=anterior,
        estado_nuevo=nuevo,
        nota=nota,
    )


# --- SLA -------------------------------------------------------------------------------


def minutos_sla(ticket) -> int:
    """El plazo de la regla más específica que coincide con el ticket."""
    mejor, puntos_mejor = None, -1
    # Por la empresa del ticket y no la activa: la tarea programada corre sin
    # empresa y vería las reglas de todas.
    for regla in ReglaSLA.objects.todas().filter(empresa_id=ticket.empresa_id):
        if regla.categoria_id and regla.categoria_id != ticket.categoria_id:
            continue
        if regla.area_id and regla.area_id != ticket.area_id:
            continue
        if regla.prioridad and regla.prioridad != ticket.prioridad:
            continue
        puntos = bool(regla.categoria_id) * 4 + bool(regla.area_id) * 2 + bool(regla.prioridad)
        if puntos > puntos_mejor:
            mejor, puntos_mejor = regla, puntos
    return mejor.minutos if mejor else SLA_POR_DEFECTO_MINUTOS


def _programar_sla(ticket, agenda: Agenda, desde, minutos_restantes: int):
    """Calcula el vencimiento y el momento del aviso desde `desde`."""
    ticket.sla_vence = agenda.sumar_minutos(desde, minutos_restantes)
    margen = int(ticket.sla_minutos * (1 - PROPORCION_ALERTA))
    antes_del_aviso = max(minutos_restantes - margen, 0)
    ticket.sla_alerta_en = (
        agenda.sumar_minutos(desde, antes_del_aviso) if antes_del_aviso else desde
    )


# --- Alta y cola -----------------------------------------------------------------------


def primer_nivel():
    return NivelSoporte.objects.order_by("orden").first()


def hay_quien_atienda(categoria, nivel, momento=None) -> bool:
    """Si algún técnico habilitado para la categoría y el nivel está en horario."""
    for tecnico in _candidatos(categoria_id=categoria.id, nivel_id=nivel.id):
        if Agenda(tecnico).en_horario(momento):
            return True
    return False


def crear_ticket(*, datos: dict, ip=None) -> Ticket:
    """Registra un ticket del formulario público y lo pone en la cola."""
    nivel = primer_nivel()
    if nivel is None:
        raise ValidationError(
            "La mesa de ayuda de esta empresa todavía no está configurada (no tiene niveles)."
        )
    caso = datos["caso"]
    ahora = timezone.now()
    anio = timezone.localdate().year
    for _intento in range(5):
        try:
            with transaction.atomic():
                ultimo = Ticket.objects.filter(anio=anio).aggregate(m=Max("secuencia"))["m"] or 0
                ticket = Ticket(
                    anio=anio,
                    secuencia=ultimo + 1,
                    prioridad=caso.prioridad,
                    nivel=nivel,
                    en_cola_desde=ahora,
                    ip_origen=ip,
                    categoria=caso.categoria,
                    **{k: v for k, v in datos.items() if k != "categoria"},
                )
                ticket.fuera_de_horario = not hay_quien_atienda(ticket.categoria, nivel, ahora)
                ticket.save()
                _movimiento(
                    ticket,
                    None,
                    f"Ticket creado por {ticket.solicitante_nombre} desde el formulario",
                    nuevo=ticket.estado,
                )
                break
        except IntegrityError:
            continue
    else:
        raise ValidationError("No se pudo numerar el ticket; inténtelo de nuevo.")

    transaction.on_commit(lambda: avisos.ticket_creado(ticket, posicion_en_cola(ticket)))
    repartir()
    return ticket


def posicion_en_cola(ticket) -> int | None:
    """Cuántos pendientes van delante, más uno. `None` si ya lo atienden."""
    if ticket.estado != Estado.NUEVO:
        return None
    delante = (
        Ticket.objects.todas()
        .filter(
            empresa_id=ticket.empresa_id,
            estado=Estado.NUEVO,
            en_cola_desde__lt=ticket.en_cola_desde,
        )
        .count()
    )
    return delante + 1


# --- Reparto por disponibilidad -------------------------------------------------------


def _candidatos(*, categoria_id=None, nivel_id=None):
    tecnicos = Tecnico.objects.filter(activo=True).select_related("usuario", "nivel")
    if categoria_id:
        tecnicos = tecnicos.filter(categorias=categoria_id)
    if nivel_id:
        tecnicos = tecnicos.filter(nivel_id=nivel_id)
    return tecnicos.prefetch_related("horarios", "ausencias", "categorias").distinct()


def _abiertos(tecnico) -> int:
    return Ticket.objects.filter(tecnico=tecnico, estado__in=Ticket.ABIERTOS_DEL_TECNICO).count()


def _siguiente_para(tecnico):
    return (
        Ticket.objects.filter(
            estado=Estado.NUEVO,
            nivel_id=tecnico.nivel_id,
            categoria__in=tecnico.categorias.all(),
        )
        .order_by("en_cola_desde")
        .first()
    )


def _asignar(ticket, tecnico, actor, descripcion, nota="") -> bool:
    """Asigna si el ticket sigue en la cola (otro proceso pudo ganarlo)."""
    ahora = timezone.now()
    agenda = Agenda(tecnico)
    minutos = minutos_sla(ticket)
    ticket.sla_minutos = minutos
    _programar_sla(ticket, agenda, ahora, minutos)
    tomados = Ticket.objects.filter(pk=ticket.pk, estado=Estado.NUEVO).update(
        estado=Estado.ASIGNADO,
        tecnico=tecnico,
        tomado_en=ahora,
        sla_minutos=minutos,
        sla_vence=ticket.sla_vence,
        sla_alerta_en=ticket.sla_alerta_en,
        sla_restante_al_pausar=None,
        sla_alerta_enviada=False,
        sla_vencido_notificado=False,
    )
    if not tomados:
        return False
    ticket.refresh_from_db()
    _movimiento(ticket, actor, descripcion, anterior=Estado.NUEVO, nuevo=Estado.ASIGNADO, nota=nota)
    if actor is None or actor.pk != tecnico.usuario_id:
        # Quien lo toma por su cuenta ya sabe que lo tiene.
        _a_la_campana(
            ticket,
            [tecnico.usuario],
            "soporte.ticket_asignado",
            "Ticket asignado",
            f"{ticket.numero} · {ticket.caso.nombre} ({ticket.get_prioridad_display()})",
        )
    return True


def _a_la_campana(ticket, usuarios, tipo, titulo, resumen):
    from apps.notificaciones import services as campana

    transaction.on_commit(
        lambda: campana.notificar(
            usuarios,
            tipo=tipo,
            titulo=titulo,
            resumen=resumen,
            enlace=f"/admin/soporte/tickets/{ticket.id}",
            empresa=ticket.empresa,
        )
    )


def repartir() -> int:
    """Da a cada técnico libre y en horario el siguiente ticket que puede atender.

    Se llama al crear un ticket, al liberarse alguien y desde la tarea
    programada (que recoge a quien empieza su turno). Primero recibe quien
    tiene menos tickets abiertos.
    """
    asignados = 0
    ahora = timezone.now()
    while True:
        libres = []
        for tecnico in _candidatos():
            abiertos = _abiertos(tecnico)
            if abiertos < tecnico.capacidad and Agenda(tecnico).en_horario(ahora):
                libres.append((abiertos, tecnico))
        libres.sort(key=lambda par: par[0])
        avance = False
        for _, tecnico in libres:
            ticket = _siguiente_para(tecnico)
            if ticket and _asignar(
                ticket, tecnico, None, f"Asignado a {tecnico} por disponibilidad"
            ):
                asignados += 1
                avance = True
                break
        if not avance:
            return asignados


def tomar_siguiente(tecnico, actor) -> Ticket | None:
    """El botón «Tomar siguiente»: aunque no le haya llegado nada (o esté fuera
    de horario), el técnico pide el próximo que puede atender."""
    ticket = _siguiente_para(tecnico)
    if ticket and _asignar(ticket, tecnico, actor, f"{tecnico} tomó el ticket de la cola"):
        return ticket
    return None


def asignar_manual(ticket, tecnico, actor, nota="") -> Ticket:
    if not tiene(actor, "asignar"):
        raise PermissionDenied("Reasignar es de quien coordina la mesa de ayuda.")
    if ticket.estado in (Estado.ATENDIDO, Estado.CERRADO):
        raise ValidationError({"estado": "El ticket ya fue atendido: no se reasigna."})
    with transaction.atomic():
        anterior = ticket.estado
        if ticket.estado != Estado.NUEVO:
            Ticket.objects.filter(pk=ticket.pk).update(estado=Estado.NUEVO, tecnico=None)
            ticket.refresh_from_db()
        if not _asignar(ticket, tecnico, actor, f"Asignado manualmente a {tecnico}", nota):
            raise ValidationError("El ticket cambió mientras tanto; vuelva a intentarlo.")
        if anterior != Estado.NUEVO:
            transaction.on_commit(repartir)
    return ticket


# --- Estados ---------------------------------------------------------------------------

TRANSICIONES = {
    Estado.ASIGNADO: {Estado.EN_CURSO, Estado.ESPERANDO_USUARIO, Estado.ATENDIDO},
    Estado.EN_CURSO: {Estado.ESPERANDO_USUARIO, Estado.ATENDIDO},
    Estado.ESPERANDO_USUARIO: {Estado.EN_CURSO, Estado.ATENDIDO},
    Estado.ATENDIDO: {Estado.CERRADO, Estado.EN_CURSO},
}


def puede_trabajarlo(usuario, ticket) -> bool:
    """El técnico asignado, o quien coordina."""
    if tiene(usuario, "asignar"):
        return True
    return bool(
        ticket.tecnico_id and ticket.tecnico.usuario_id == usuario.id and tiene(usuario, "atender")
    )


def acciones_disponibles(usuario, ticket) -> list[str]:
    if not puede_trabajarlo(usuario, ticket):
        return []
    destinos = TRANSICIONES.get(ticket.estado, set())
    return [estado for estado in Estado.values if estado in destinos]


def cambiar_estado(ticket, actor, estado, nota="") -> Ticket:
    if not puede_trabajarlo(actor, ticket):
        raise PermissionDenied("Este ticket lo trabaja el técnico asignado, o quien coordina.")
    if estado not in TRANSICIONES.get(ticket.estado, set()):
        raise ValidationError(
            {
                "estado": f"Un ticket {ticket.get_estado_display().lower()} no puede pasar a "
                f"«{Estado(estado).label.lower()}»."
            }
        )
    nota = (nota or "").strip()
    if estado == Estado.ESPERANDO_USUARIO and not nota:
        raise ValidationError({"nota": "Diga qué necesita del usuario: es lo que le llega."})
    with transaction.atomic():
        _mover(ticket, actor, estado, nota)
    if estado == Estado.ATENDIDO:
        transaction.on_commit(lambda: avisos.ticket_atendido(ticket))
        transaction.on_commit(repartir)
    if estado == Estado.ESPERANDO_USUARIO:
        transaction.on_commit(lambda: avisos.ticket_respondido(ticket, nota))
    return ticket


def _mover(ticket, actor, estado, nota="", descripcion=None):
    anterior = ticket.estado
    ahora = timezone.now()
    agenda = Agenda(ticket.tecnico) if ticket.tecnico_id else None
    if estado == Estado.ESPERANDO_USUARIO and agenda and ticket.sla_vence:
        ticket.sla_restante_al_pausar = agenda.minutos_entre(ahora, ticket.sla_vence)
    if anterior == Estado.ESPERANDO_USUARIO and estado != Estado.ESPERANDO_USUARIO and agenda:
        restante = ticket.sla_restante_al_pausar
        if restante is not None:
            _programar_sla(ticket, agenda, ahora, restante)
        ticket.sla_restante_al_pausar = None
    if estado == Estado.ATENDIDO:
        ticket.atendido_en = ahora
    if estado == Estado.CERRADO:
        ticket.cerrado_en = ahora
    if anterior == Estado.ATENDIDO and estado == Estado.EN_CURSO:
        ticket.atendido_en = None
    ticket.estado = estado
    ticket.save()
    texto = descripcion or f"{Estado(anterior).label} → {Estado(estado).label}"
    _movimiento(ticket, actor, texto, anterior=anterior, nuevo=estado, nota=nota)


def escalar(ticket, actor, motivo: str) -> Ticket:
    """Pasa el ticket al nivel siguiente: vuelve a la cola de ese nivel con su
    lugar original (no pierde su turno por haberse escalado)."""
    if not puede_trabajarlo(actor, ticket):
        raise PermissionDenied("Escala el técnico asignado, o quien coordina.")
    motivo = (motivo or "").strip()
    if not motivo:
        raise ValidationError(
            {"motivo": "Diga por qué se escala: es lo que lee el siguiente nivel."}
        )
    if ticket.estado in (Estado.ATENDIDO, Estado.CERRADO, Estado.NUEVO):
        raise ValidationError({"estado": "Solo se escala un ticket que se está atendiendo."})
    siguiente = NivelSoporte.objects.filter(orden__gt=ticket.nivel.orden).order_by("orden").first()
    if siguiente is None:
        raise ValidationError({"nivel": "No hay un nivel superior al que escalar."})
    with transaction.atomic():
        anterior = ticket.estado
        ticket.nivel = siguiente
        ticket.tecnico = None
        ticket.estado = Estado.NUEVO
        ticket.sla_vence = ticket.sla_alerta_en = None
        ticket.save()
        _movimiento(
            ticket,
            actor,
            f"Escalado a {siguiente}",
            anterior=anterior,
            nuevo=Estado.NUEVO,
            nota=motivo,
        )
    transaction.on_commit(repartir)
    return ticket


# --- Mensajes --------------------------------------------------------------------------


def responder(ticket, actor, texto, *, interno=False) -> MensajeTicket:
    """Respuesta del equipo. Una respuesta pública a un ticket asignado lo pone
    en curso."""
    if not puede_trabajarlo(actor, ticket) and not tiene(actor, "ver_todos"):
        raise PermissionDenied("Responde el técnico asignado, o quien coordina.")
    if ticket.estado == Estado.CERRADO:
        raise ValidationError({"estado": "El ticket está cerrado."})
    texto = (texto or "").strip()
    if not texto:
        raise ValidationError({"texto": "Escriba la respuesta."})
    with transaction.atomic():
        mensaje = MensajeTicket.objects.create(
            ticket=ticket, autor=actor, texto=texto, interno=interno
        )
        if not interno and ticket.estado == Estado.ASIGNADO:
            _mover(ticket, actor, Estado.EN_CURSO, descripcion="Primera respuesta al usuario")
    if not interno:
        transaction.on_commit(lambda: avisos.ticket_respondido(ticket, texto))
    return mensaje


def mensaje_del_solicitante(ticket, texto) -> MensajeTicket:
    """Lo que escribe quien pidió desde la página de seguimiento. Si se
    esperaba su respuesta, el ticket vuelve a curso; si ya estaba atendido, se
    reabre."""
    if ticket.estado == Estado.CERRADO:
        raise ValidationError(
            {"estado": "El ticket está cerrado. Si el problema sigue, cree uno nuevo."}
        )
    texto = (texto or "").strip()
    if not texto:
        raise ValidationError({"texto": "Escriba su mensaje."})
    with transaction.atomic():
        mensaje = MensajeTicket.objects.create(ticket=ticket, texto=texto, del_solicitante=True)
        if ticket.estado == Estado.ESPERANDO_USUARIO:
            _mover(ticket, None, Estado.EN_CURSO, descripcion="El usuario respondió")
        elif ticket.estado == Estado.ATENDIDO:
            _mover(ticket, None, Estado.EN_CURSO, descripcion="El usuario reabrió el ticket")
        if ticket.tecnico_id:
            _a_la_campana(
                ticket,
                [ticket.tecnico.usuario],
                "soporte.respuesta_del_usuario",
                "El usuario respondió",
                f"{ticket.numero} · {ticket.solicitante_nombre}: {texto[:120]}",
            )
    return mensaje


def confirmar_solucion(ticket) -> Ticket:
    """Quien pidió confirma que quedó resuelto: se cierra."""
    if ticket.estado != Estado.ATENDIDO:
        raise ValidationError({"estado": "Solo se confirma un ticket atendido."})
    with transaction.atomic():
        _mover(ticket, None, Estado.CERRADO, descripcion="El usuario confirmó la solución")
    return ticket


def guardar_adjuntos(ticket, archivos, *, mensaje=None, del_solicitante=False, interno=False):
    """Guarda los archivos ya validados (`serializers.validar_adjuntos`)."""
    for archivo in archivos:
        AdjuntoTicket.objects.create(
            ticket=ticket,
            mensaje=mensaje,
            archivo=archivo,
            nombre_original=archivo.name[:255],
            tamano=archivo.size,
            del_solicitante=del_solicitante,
            interno=interno,
        )


# --- Horas fuera de horario ------------------------------------------------------------


def fuera_de_su_horario(tecnico, momento=None) -> bool:
    return tecnico is not None and not Agenda(tecnico).en_horario(momento)


def registrar_horas(ticket, tecnico, *, fecha, horas, descripcion) -> HorasFueraDeHorario:
    if tecnico is None:
        raise PermissionDenied("Solo un técnico de la mesa registra horas.")
    return HorasFueraDeHorario.objects.create(
        ticket=ticket, tecnico=tecnico, fecha=fecha, horas=horas, descripcion=descripcion
    )


def revisar_horas(registro, actor, *, aprobar: bool, nota="") -> HorasFueraDeHorario:
    if not tiene(actor, "aprobar_horas"):
        raise PermissionDenied("Las horas las aprueba un supervisor de la mesa.")
    if registro.estado != HorasFueraDeHorario.Estado.PENDIENTE:
        raise ValidationError({"estado": "Ese registro ya se revisó."})
    registro.estado = (
        HorasFueraDeHorario.Estado.APROBADO if aprobar else HorasFueraDeHorario.Estado.RECHAZADO
    )
    registro.revisado_por = actor
    registro.revisado_en = timezone.now()
    registro.nota_revision = nota or ""
    registro.save()
    return registro


# --- Ciclo de la tarea programada ------------------------------------------------------


def ciclo(ahora=None) -> dict:
    """Lo que hace la tarea oculta cada 5 minutos, empresa por empresa:
    repartir lo pendiente, avisar al 80 % del SLA, escalar los vencidos y
    cerrar los atendidos que nadie reabrió."""
    ahora = ahora or timezone.now()
    resumen = {"asignados": repartir(), "alertas": 0, "vencidos": 0, "cerrados": 0}

    en_atencion = Ticket.objects.filter(estado__in=Ticket.ABIERTOS_DEL_TECNICO).select_related(
        "tecnico__usuario", "nivel"
    )
    for ticket in en_atencion.filter(sla_alerta_enviada=False, sla_alerta_en__lte=ahora):
        Ticket.objects.filter(pk=ticket.pk).update(sla_alerta_enviada=True)
        avisos.alerta_sla(ticket)
        resumen["alertas"] += 1
    for ticket in en_atencion.filter(sla_vencido_notificado=False, sla_vence__lte=ahora):
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_vencido_notificado=True, escalado_por_sla=True
        )
        _movimiento(ticket, None, "SLA vencido: se notificó a la línea de supervisión")
        avisos.sla_vencido(ticket)
        resumen["vencidos"] += 1

    dias = getattr(settings, "SOPORTE_DIAS_CIERRE_AUTOMATICO", 3)
    limite = ahora - timedelta(days=dias)
    for ticket in Ticket.objects.filter(estado=Estado.ATENDIDO, atendido_en__lte=limite):
        with transaction.atomic():
            _mover(
                ticket,
                None,
                Estado.CERRADO,
                descripcion=f"Cerrado automáticamente tras {dias} día(s) sin respuesta del usuario",
            )
        resumen["cerrados"] += 1
    return resumen


def carga_del_equipo():
    """Cuántos tickets abiertos tiene cada técnico (para la bandeja del coordinador)."""
    return (
        Ticket.objects.filter(estado__in=Ticket.ABIERTOS_DEL_TECNICO)
        .values("tecnico")
        .annotate(total=Count("id"), mas_antiguo=Min("tomado_en"))
    )


def en_cola_para(tecnico) -> int:
    """Cuántos tickets de su nivel y sus categorías esperan en la cola."""
    if tecnico is None:
        return 0
    return Ticket.objects.filter(
        Q(estado=Estado.NUEVO),
        Q(nivel_id=tecnico.nivel_id),
        Q(categoria__in=tecnico.categorias.all()),
    ).count()
