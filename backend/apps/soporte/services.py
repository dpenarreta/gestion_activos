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

from . import avisos, criticidad, sla
from .horario import Agenda
from .models import (
    AdjuntoTicket,
    AprobacionTicket,
    Canal,
    ConfiguracionMesa,
    EncuestaTicket,
    FeriadoMesa,
    HorarioMesa,
    HorasFueraDeHorario,
    MensajeChatTicket,
    MensajeTicket,
    MovimientoTicket,
    NivelSoporte,
    Prioridad,
    Tecnico,
    Ticket,
)

Estado = Ticket.Estado


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


def minutos_sla(ticket) -> int:
    """El plazo de solución que le corresponde (ver `sla.plazos`)."""
    return sla.plazos(ticket)[1]


# --- Alta y cola -----------------------------------------------------------------------


def primer_nivel():
    return NivelSoporte.objects.order_by("orden").first()


def hay_quien_atienda(categoria, nivel, momento=None) -> bool:
    """Si algún técnico habilitado para la categoría y el nivel está en horario."""
    for tecnico in _candidatos(categoria_id=categoria.id, nivel_id=nivel.id):
        if Agenda(tecnico).en_horario(momento):
            return True
    return False


def crear_ticket(
    *,
    datos: dict,
    ip=None,
    solicitante=None,
    registrado_por=None,
    canal=Canal.PORTAL,
    repartir_ahora=True,
) -> Ticket:
    """Registra un ticket y lo pone en la cola.

    Lo crea quien pide desde el portal, o alguien del equipo en su nombre
    (`registrado_por`, con el canal por donde llegó: teléfono, WhatsApp…). El
    caso fija el tipo, la prioridad base y el nivel por donde entra; la matriz
    impacto × urgencia puede subir la prioridad. Los dos plazos corren desde
    ahora.
    """
    caso = datos["caso"]
    nivel = caso.nivel_inicial or primer_nivel()
    if nivel is None:
        raise ValidationError(
            "La mesa de ayuda de esta empresa todavía no está configurada (no tiene niveles)."
        )
    ahora = timezone.now()
    anio = timezone.localdate().year
    prioridad = sla.prioridad_inicial(caso.prioridad, datos.get("impacto"), datos.get("urgencia"))
    for _intento in range(5):
        try:
            with transaction.atomic():
                ultimo = Ticket.objects.filter(anio=anio).aggregate(m=Max("secuencia"))["m"] or 0
                ticket = Ticket(
                    anio=anio,
                    secuencia=ultimo + 1,
                    tipo=caso.tipo,
                    prioridad_base=caso.prioridad,
                    prioridad=prioridad,
                    nivel=nivel,
                    en_cola_desde=ahora,
                    ip_origen=ip,
                    canal=canal,
                    solicitante=solicitante,
                    registrado_por=registrado_por,
                    categoria=caso.categoria,
                    **{k: v for k, v in datos.items() if k != "categoria"},
                )
                ticket.fuera_de_horario = not hay_quien_atienda(ticket.categoria, nivel, ahora)
                ticket.nivel_solicitante_id = criticidad.nivel_de(
                    solicitante, ticket.categoria.empresa_id
                )
                criticidad.aplicar(ticket)
                pide_aprobacion = caso.requiere_aprobacion
                if pide_aprobacion:
                    # No entra a la cola ni corre ningún plazo hasta el visto bueno.
                    ticket.estado = Estado.ESPERANDO_APROBACION
                else:
                    sla.iniciar(ticket, ahora)
                ticket.save()
                origen = (
                    f"Ticket registrado por {registrado_por.get_full_name() or registrado_por}"
                    f" ({ticket.get_canal_display().lower()}) a nombre de {ticket.solicitante_nombre}"
                    if registrado_por
                    else f"Ticket creado por {ticket.solicitante_nombre} desde Soporte TI"
                )
                _movimiento(ticket, registrado_por, origen, nuevo=ticket.estado)
                if prioridad != caso.prioridad:
                    _movimiento(
                        ticket,
                        None,
                        f"Prioridad de {Prioridad(caso.prioridad).label} a "
                        f"{Prioridad(prioridad).label} por impacto y urgencia",
                    )
                if pide_aprobacion:
                    _pedir_aprobaciones(ticket)
                break
        except IntegrityError:
            continue
    else:
        raise ValidationError("No se pudo numerar el ticket; inténtelo de nuevo.")

    transaction.on_commit(lambda: avisos.ticket_creado(ticket, posicion_en_cola(ticket)))
    if repartir_ahora and ticket.estado == Estado.NUEVO:
        repartir()
    return ticket


# --- Aprobaciones ----------------------------------------------------------------------


def _responsable_con_cuenta(departamento):
    empleado = departamento.responsable if departamento else None
    usuario = getattr(empleado, "usuario", None) if empleado else None
    return usuario if usuario is not None and usuario.is_active else None


def _pedir_aprobaciones(ticket):
    """Crea un visto bueno por cada aprobador del caso y les avisa. El correo
    los lleva al sistema: se aprueba entrando con la cuenta."""
    caso = ticket.caso
    pedidos = []
    if caso.aprueba_jefe_area:
        area = ticket.area
        pedidos.append(
            (
                f"Jefe de área ({area.nombre})" if area else "Jefe de área",
                _responsable_con_cuenta(area),
            )
        )
    for departamento in caso.aprueban.select_related("responsable__usuario"):
        pedidos.append((departamento.nombre, _responsable_con_cuenta(departamento)))
    for rol, aprobador in pedidos:
        aprobacion = AprobacionTicket.objects.create(ticket=ticket, rol=rol, aprobador=aprobador)
        transaction.on_commit(lambda a=aprobacion: avisos.aprobacion_pendiente(a))
    _movimiento(
        ticket,
        None,
        "Esperando aprobación de: " + ", ".join(rol for rol, _ in pedidos),
        nuevo=Estado.ESPERANDO_APROBACION,
    )


def aprobaciones_de(usuario):
    """Lo que le toca decidir: las suyas y, a quien coordina, también las que
    no tienen aprobador (el área no tiene responsable con cuenta)."""
    pendientes = AprobacionTicket.objects.filter(
        estado=AprobacionTicket.Estado.PENDIENTE,
        ticket__estado=Estado.ESPERANDO_APROBACION,
    )
    filtro = Q(aprobador=usuario)
    if tiene(usuario, "asignar"):
        filtro |= Q(aprobador__isnull=True)
    return pendientes.filter(filtro)


def decidir_aprobacion(aprobacion, actor, *, aprobar: bool, nota="") -> Ticket:
    """El aprobador (o quien coordina, si no hay aprobador) decide. Con todos
    los vistos buenos, la solicitud entra a la cola y empiezan sus plazos; un
    rechazo la cierra y se le avisa a quien pidió."""
    puede = aprobacion.aprobador_id == actor.id or (
        aprobacion.aprobador_id is None and tiene(actor, "asignar")
    )
    if not puede:
        raise PermissionDenied("Esta aprobación le corresponde a otra persona.")
    if aprobacion.estado != AprobacionTicket.Estado.PENDIENTE:
        raise ValidationError({"estado": "Esta aprobación ya se decidió."})
    nota = (nota or "").strip()
    if not aprobar and not nota:
        raise ValidationError(
            {"nota": "Diga por qué no aprueba: es lo que le llega a quien pidió."}
        )
    ticket = aprobacion.ticket
    ahora = timezone.now()
    with transaction.atomic():
        aprobacion.estado = (
            AprobacionTicket.Estado.APROBADA if aprobar else AprobacionTicket.Estado.RECHAZADA
        )
        aprobacion.decidido_por = actor
        aprobacion.decidido_en = ahora
        aprobacion.nota = nota[:500]
        aprobacion.save()
        quien = actor.get_full_name() or actor.username
        if not aprobar:
            ticket.estado = Estado.CERRADO
            ticket.cerrado_en = ahora
            ticket.save()
            _movimiento(
                ticket,
                actor,
                f"No aprobado por {quien} ({aprobacion.rol})",
                anterior=Estado.ESPERANDO_APROBACION,
                nuevo=Estado.CERRADO,
                nota=nota,
            )
            transaction.on_commit(lambda: avisos.solicitud_rechazada(ticket, aprobacion))
            return ticket
        _movimiento(ticket, actor, f"Aprobado por {quien} ({aprobacion.rol})", nota=nota)
        faltan = ticket.aprobaciones.exclude(estado=AprobacionTicket.Estado.APROBADA).exists()
        if not faltan:
            # Con todos los vistos buenos entra a la cola: la entrega se mide
            # desde la aprobación.
            ticket.estado = Estado.NUEVO
            ticket.en_cola_desde = ahora
            sla.iniciar(ticket, ahora)
            ticket.save()
            _movimiento(
                ticket,
                None,
                "Aprobado: entra a la cola",
                anterior=Estado.ESPERANDO_APROBACION,
                nuevo=Estado.NUEVO,
            )
            transaction.on_commit(repartir)
    return ticket


def posicion_en_cola(ticket) -> int | None:
    """Cuántos pendientes van delante, más uno. `None` si ya lo atienden."""
    if ticket.estado != Estado.NUEVO:
        return None
    # Delante va lo más crítico y, a igual criticidad, lo que llegó antes.
    delante = (
        Ticket.objects.todas()
        .filter(empresa_id=ticket.empresa_id, estado=Estado.NUEVO)
        .filter(
            Q(puntaje__gt=ticket.puntaje)
            | Q(puntaje=ticket.puntaje, en_cola_desde__lt=ticket.en_cola_desde)
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
        # El más crítico primero; entre iguales, el que llegó antes.
        .order_by("-puntaje", "en_cola_desde")
        .first()
    )


def _asignar(ticket, tecnico, actor, descripcion, nota="") -> bool:
    """Asigna si el ticket sigue en la cola (otro proceso pudo ganarlo). La
    primera vez que se toma arranca el reloj de solución (cycle time); al
    reasignarlo o tras escalarlo sigue el mismo."""
    ahora = timezone.now()
    campos = {"estado": Estado.ASIGNADO, "tecnico": tecnico, "tomado_en": ticket.tomado_en or ahora}
    if ticket.sla_respuesta_vence is None and ticket.respondido_en is None:
        sla.iniciar(ticket, ticket.en_cola_desde)  # un ticket de antes de los plazos
        campos.update(
            sla_respuesta_minutos=ticket.sla_respuesta_minutos,
            sla_respuesta_vence=ticket.sla_respuesta_vence,
        )
    if not sla.solucion_iniciada(ticket):
        sla.iniciar_solucion(ticket, ahora)
        campos.update(
            sla_minutos=ticket.sla_minutos,
            sla_vence=ticket.sla_vence,
            sla_alerta_en=ticket.sla_alerta_en,
        )
    tomados = Ticket.objects.filter(pk=ticket.pk, estado=Estado.NUEVO).update(**campos)
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


def registrar_ticket(*, datos, actor, canal, asignarme=False, solicitante=None) -> Ticket:
    """Alta interna: el equipo registra el ticket en nombre de quien pide. Si
    quien registra es técnico y lo pide, se lo queda (lo resuelve en la misma
    llamada); si no, entra a la cola como cualquier otro."""
    ticket = crear_ticket(
        datos=datos,
        solicitante=solicitante,
        registrado_por=actor,
        canal=canal,
        repartir_ahora=False,
    )
    tecnico = tecnico_de(actor) if asignarme else None
    if tecnico is not None:
        _asignar(ticket, tecnico, actor, f"{tecnico} registró el ticket y lo tomó")
    transaction.on_commit(repartir)
    return ticket


def guardar_mesa(datos) -> None:
    """Configuración → Mesa de ayuda → Horario y metas, de una vez."""
    with transaction.atomic():
        configuracion = ConfiguracionMesa.objects.first() or ConfiguracionMesa()
        configuracion.meta_sla = datos["meta_sla"]
        configuracion.meta_sla_critica = datos["meta_sla_critica"]
        configuracion.critica_24x7 = datos["critica_24x7"]
        if "etiquetas" in datos:
            configuracion.etiquetas = datos["etiquetas"]
        configuracion.save()
        HorarioMesa.objects.all().delete()
        for franja in datos["horarios"]:
            HorarioMesa.objects.create(**franja)
        FeriadoMesa.objects.all().delete()
        for feriado in datos["feriados"]:
            FeriadoMesa.objects.create(**feriado)


def tomar_siguiente(tecnico, actor) -> Ticket | None:
    """El botón «Tomar siguiente»: aunque no le haya llegado nada (o esté fuera
    de horario), el técnico pide el próximo que puede atender."""
    ticket = _siguiente_para(tecnico)
    if ticket and _asignar(ticket, tecnico, actor, f"{tecnico} tomó el ticket de la cola"):
        return ticket
    return None


def puede_tomarlo(tecnico, ticket) -> bool:
    """Un técnico toma de la cola lo de su nivel y sus categorías."""
    return bool(
        tecnico
        and ticket.estado == Estado.NUEVO
        and ticket.nivel_id == tecnico.nivel_id
        and tecnico.categorias.filter(pk=ticket.categoria_id).exists()
    )


def por_que_no_tomarlo(tecnico, ticket) -> str:
    """Por qué no aparece «Tomar este ticket» (auditoría UX/UI, 30/10/2026:
    faltaba sin explicación). Vacío si se puede o si no aplica."""
    if ticket.estado != Estado.NUEVO or puede_tomarlo(tecnico, ticket):
        return ""
    if tecnico is None:
        return "Usted no es técnico de la mesa de ayuda: no toma tickets de la cola."
    if ticket.nivel_id != tecnico.nivel_id:
        return f"El ticket está en «{ticket.nivel}» y usted atiende «{tecnico.nivel}»."
    return f"Usted no atiende la categoría «{ticket.categoria.nombre}»."


def tomar(ticket, tecnico, actor) -> Ticket:
    """«Tomar este ticket» desde su ficha (auditoría UX/UI, 30/10/2026: el
    técnico que abría un ticket vencido de la cola no podía quedárselo; solo
    «Tomar siguiente», que da el más crítico, no ese)."""
    if not puede_tomarlo(tecnico, ticket):
        raise PermissionDenied("Este ticket no es de su nivel o de sus categorías.")
    if not _asignar(ticket, tecnico, actor, f"{tecnico} tomó el ticket de la cola"):
        raise ValidationError("Otra persona lo tomó mientras tanto.")
    return ticket


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
    sla.al_cambiar_de_estado(ticket, anterior, estado, ahora)
    if estado == Estado.ATENDIDO:
        ticket.atendido_en = ahora
    if estado == Estado.CERRADO:
        ticket.cerrado_en = ahora
    if anterior == Estado.ATENDIDO and estado == Estado.EN_CURSO:
        ticket.atendido_en = None
        ticket.reaperturas += 1
    ticket.estado = estado
    ticket.save()
    # En palabras, no con una flecha (el lector de pantalla leía «flecha
    # derecha»).
    texto = descripcion or f"Pasó de {Estado(anterior).label} a {Estado(estado).label}"
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
        # El plazo sigue: se escala el ticket, no se le regala tiempo.
        sla.al_cambiar_de_estado(ticket, anterior, Estado.NUEVO, timezone.now())
        ticket.nivel = siguiente
        ticket.tecnico = None
        ticket.estado = Estado.NUEVO
        ticket.escalamientos += 1
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


def cambiar_prioridad(ticket, actor, *, prioridad, justificacion, impacto="", urgencia=""):
    """El técnico o quien coordina ajusta la prioridad, con justificación. El
    plazo se recalcula conservando lo ya consumido."""
    if not puede_trabajarlo(actor, ticket):
        raise PermissionDenied("La prioridad la ajusta el técnico asignado, o quien coordina.")
    if ticket.estado in (Estado.ATENDIDO, Estado.CERRADO):
        raise ValidationError({"estado": "El ticket ya fue atendido."})
    justificacion = (justificacion or "").strip()
    if not justificacion:
        raise ValidationError({"justificacion": "Diga por qué cambia la prioridad."})
    if impacto and urgencia:
        prioridad = sla.prioridad_por_matriz(impacto, urgencia) or prioridad
    if prioridad not in Prioridad.values:
        raise ValidationError({"prioridad": "Elija una prioridad."})
    anterior = ticket.prioridad
    with transaction.atomic():
        if impacto:
            ticket.impacto = impacto
        if urgencia:
            ticket.urgencia = urgencia
        criticidad.aplicar(ticket)
        sla.recalcular_por_prioridad(ticket, prioridad, timezone.now())
        ticket.save()
        _movimiento(
            ticket,
            actor,
            f"Prioridad de {Prioridad(anterior).label} a {Prioridad(prioridad).label}",
            nota=justificacion,
        )
    return ticket


# --- Chat del ticket ---------------------------------------------------------------------

#: Mientras el ticket está a cargo del técnico (desde que lo toma).
ESTADOS_CON_CHAT = (
    Estado.ASIGNADO,
    Estado.EN_CURSO,
    Estado.ESPERANDO_USUARIO,
    Estado.ATENDIDO,
)
LARGO_CHAT = 2000


def chat_abierto(ticket) -> bool:
    return bool(ticket.tecnico_id) and ticket.estado in ESTADOS_CON_CHAT


def puede_ver_chat(usuario, ticket) -> bool:
    """El técnico asignado y quien coordina o ve todo (para auditoría)."""
    return puede_trabajarlo(usuario, ticket) or tiene(usuario, "ver_todos")


def puede_escribir_chat(usuario, ticket) -> bool:
    """Solo el técnico que lo tiene a su cargo, mientras está abierto."""
    return (
        chat_abierto(ticket)
        and ticket.tecnico.usuario_id == usuario.id
        and tiene(usuario, "atender")
    )


def solicitante_puede_escribir_chat(ticket) -> bool:
    """Quien reportó escribe mientras el chat está abierto, salvo con el
    ticket resuelto: ahí «sigue fallando» va por «Responder», que lo reabre
    (si lo escribiera en el chat, el ticket se cerraría solo igual)."""
    return chat_abierto(ticket) and ticket.estado != Estado.ATENDIDO


def motivo_chat(ticket, *, del_solicitante, a_cargo=False) -> str:
    """Por qué no se puede escribir ahora, según la causa."""
    if ticket.estado == Estado.CERRADO:
        return "El ticket está cerrado: el chat queda como constancia."
    if del_solicitante and ticket.estado == Estado.ATENDIDO:
        return (
            "Su ticket está resuelto. Si el problema sigue, use «No, sigue el "
            "problema» o «Responder»: así se reabre."
        )
    if ticket.estado == Estado.ESPERANDO_APROBACION:
        return "El chat está en pausa mientras el ticket espera aprobación."
    if not ticket.tecnico_id or ticket.estado == Estado.NUEVO:
        return "El chat está en pausa hasta que un técnico tome el ticket."
    if not del_solicitante and not a_cargo:
        return "Solo lectura: conversan el técnico a cargo y quien reportó el ticket."
    return ""


def escribir_en_chat(ticket, actor, texto, *, del_solicitante=False) -> MensajeChatTicket:
    """Un mensaje del chat del ticket. No toca el estado ni los plazos: es
    para aclarar detalles (decidido el 30/10/2026). Avisa al otro en la
    campana, con el enlace a su vista del ticket."""
    texto = (texto or "").strip()
    if not texto:
        raise ValidationError({"texto": "Escriba un mensaje."})
    if len(texto) > LARGO_CHAT:
        raise ValidationError({"texto": f"Como máximo {LARGO_CHAT} caracteres."})
    abierto = solicitante_puede_escribir_chat(ticket) if del_solicitante else chat_abierto(ticket)
    if not abierto:
        raise ValidationError(
            {"texto": motivo_chat(ticket, del_solicitante=del_solicitante, a_cargo=True)}
        )
    mensaje = MensajeChatTicket.objects.create(
        ticket=ticket, autor=actor, del_solicitante=del_solicitante, texto=texto
    )
    from apps.notificaciones import services as campana

    if del_solicitante:
        destinatarios = [ticket.tecnico.usuario]
        enlace = f"/admin/soporte/tickets/{ticket.id}"
        titulo = f"Chat del ticket {ticket.numero}"
    else:
        destinatarios = [ticket.solicitante] if ticket.solicitante_id else []
        enlace = f"/admin/ayuda/tickets/{ticket.id}"
        titulo = f"Soporte le escribió sobre {ticket.numero}"
    if destinatarios:
        resumen = f"{actor.get_full_name() or actor.username}: {texto[:160]}"
        transaction.on_commit(
            lambda: campana.notificar(
                destinatarios,
                tipo="soporte.chat",
                titulo=titulo,
                resumen=resumen,
                enlace=enlace,
                empresa=ticket.empresa,
            )
        )
    return mensaje


def responder_encuesta(ticket, *, calificacion, resuelto, comentario="") -> EncuestaTicket:
    """La encuesta de satisfacción: una por ticket, cuando ya se atendió."""
    if ticket.estado not in (Estado.ATENDIDO, Estado.CERRADO):
        raise ValidationError({"estado": "La encuesta se responde cuando el ticket se atendió."})
    if EncuestaTicket.objects.filter(ticket=ticket).exists():
        raise ValidationError({"encuesta": "Esta encuesta ya se respondió. ¡Gracias!"})
    return EncuestaTicket.objects.create(
        ticket=ticket,
        calificacion=calificacion,
        resuelto=resuelto,
        comentario=(comentario or "").strip(),
    )


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
    repartir lo pendiente, avisar al 80 % del SLA, escalar los vencidos (de
    respuesta y de solución) y cerrar los atendidos que nadie reabrió."""
    ahora = ahora or timezone.now()
    resumen = {
        "asignados": repartir(),
        "alertas": 0,
        "vencidos": 0,
        "sin_respuesta": 0,
        "cerrados": 0,
    }

    # Los tickets de antes de los dos relojes los reciben aquí: el de respuesta
    # desde que entraron y el de solución desde que se tomaron.
    for ticket in Ticket.objects.filter(
        estado__in=sla.CORRE, sla_respuesta_vence__isnull=True, respondido_en__isnull=True
    ).select_related("caso"):
        sla.iniciar(ticket, ticket.en_cola_desde)
        ticket.save()
    for ticket in Ticket.objects.filter(
        estado__in=sla.CORRE,
        tomado_en__isnull=False,
        sla_vence__isnull=True,
        sla_restante_al_pausar__isnull=True,
    ).select_related("caso"):
        sla.iniciar_solucion(ticket, ticket.tomado_en)
        ticket.save()

    # El reloj de solución corre también en la cola: un ticket que espera puede
    # vencerse sin que nadie lo haya tomado.
    en_atencion = Ticket.objects.filter(estado__in=sla.CORRE).select_related(
        "tecnico__usuario", "nivel"
    )
    for ticket in en_atencion.filter(
        respondido_en__isnull=True,
        sla_respuesta_vencida_notificada=False,
        sla_respuesta_vence__lte=ahora,
    ):
        Ticket.objects.filter(pk=ticket.pk).update(sla_respuesta_vencida_notificada=True)
        _movimiento(ticket, None, "Plazo de respuesta vencido sin respuesta del equipo")
        destinatarios = list(ticket.nivel.supervisores.all())
        if ticket.tecnico_id:
            destinatarios.append(ticket.tecnico.usuario)
        _a_la_campana(
            ticket,
            destinatarios,
            "soporte.respuesta_vencida",
            "Respuesta vencida",
            f"{ticket.numero} · {ticket.get_prioridad_display()}: nadie le respondió a "
            f"{ticket.solicitante_nombre}",
        )
        resumen["sin_respuesta"] += 1
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

    # Cierre automático a los N días **hábiles** de la mesa: un ticket atendido
    # el viernes no se cierra el lunes sin que el usuario tuviera un día para
    # responder.
    dias = getattr(settings, "SOPORTE_DIAS_CIERRE_AUTOMATICO", 3)
    for ticket in Ticket.objects.filter(
        estado=Estado.ATENDIDO, atendido_en__lte=ahora - timedelta(days=dias)
    ):
        if sla.dias_habiles_entre(ticket.empresa_id, ticket.atendido_en, ahora) < dias:
            continue
        with transaction.atomic():
            _mover(
                ticket,
                None,
                Estado.CERRADO,
                descripcion=f"Cerrado automáticamente tras {dias} "
                f"{'día hábil' if dias == 1 else 'días hábiles'} sin respuesta del usuario",
            )
        transaction.on_commit(lambda t=ticket: avisos.ticket_cerrado(t))
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
