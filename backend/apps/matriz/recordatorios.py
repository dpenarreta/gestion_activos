"""Recordatorios, escalamiento y reintentos de la Matriz (§12).

Todo lo que corre solo es **idempotente**: la tarea programada pasa cada cinco
minutos y puede pasar dos veces a la vez, y nada de eso debe duplicar un
correo. Lo garantiza la clave única de cada notificación (§12.4), no la
memoria del proceso: la fila se crea antes de enviar y la segunda pasada choca
en la base.

Las fechas se cuentan en la zona horaria de **cada empresa**: «faltan 3 días»
y «a partir de las 08:00» son de quien recibe el aviso, no del servidor.
"""

import datetime
import logging
import uuid
from dataclasses import dataclass

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.correos import servicio as servicio_de_correos

from . import estados
from .fechas import MESES
from .models import (
    ConfiguracionRecordatorios,
    EstadoNotificacion,
    Notificacion,
    Periodo,
    TipoNotificacion,
)
from .servicios import registrar_evento

logger = logging.getLogger("apps.matriz")

#: Mientras se envía, la fila ya existe (es el candado contra duplicados).
#: Si el proceso muere antes de terminar, queda fallida con este motivo y la
#: recoge el reintento.
EN_CURSO = "Envío interrumpido antes de terminar."

# Los asuntos y el diseño de cada aviso están en `apps.correos.catalogo` (y se
# pueden personalizar en Configuración → Notificaciones → Plantillas de correo).


def maximo_intentos() -> int:
    return getattr(settings, "NOTIFICATION_MAX_ATTEMPTS", 3)


# --- Configuración -------------------------------------------------------------------


def configuracion_de(empresa) -> ConfiguracionRecordatorios:
    """La de la empresa; se crea con los valores por defecto si no existe."""
    config, _ = ConfiguracionRecordatorios.objects.todas().get_or_create(empresa=empresa)
    return config


def normalizar_anticipaciones(valores) -> list[int]:
    """Sin repetir, de mayor a menor, y con el día del vencimiento siempre."""
    return sorted({int(v) for v in valores} | {0}, reverse=True)


# --- Fechas locales --------------------------------------------------------------------


def _hoy_y_hora(empresa, ahora):
    local = ahora.astimezone(estados.zona_de(empresa))
    return local.date(), local.time()


def _dia_de_vencimiento(periodo) -> datetime.date:
    return periodo.vence_en.astimezone(estados.zona_de(periodo.empresa)).date()


def texto_de_vencimiento(periodo) -> str:
    """«28 de octubre de 2026 · 17:00», en la hora de la empresa."""
    local = periodo.vence_en.astimezone(estados.zona_de(periodo.empresa))
    return f"{local.day} de {MESES[local.month - 1].lower()} de {local.year} · {local:%H:%M}"


# --- Destinatarios -------------------------------------------------------------------


@dataclass(frozen=True)
class Destinatario:
    usuario: object
    correo: str

    @property
    def nombre(self) -> str:
        return self.usuario.get_full_name() or self.usuario.username


def _sin_repetir(usuarios) -> list[Destinatario]:
    """Una vez por correo, y sin quien no tiene correo (§12.1)."""
    vistos, resultado = set(), []
    for usuario in usuarios:
        if usuario is None or not usuario.email or not usuario.is_active:
            continue
        correo = usuario.email.strip().lower()
        if correo in vistos:
            continue
        vistos.add(correo)
        resultado.append(Destinatario(usuario, correo))
    return resultado


def destinatarios(periodo, config=None) -> list[Destinatario]:
    """El responsable y, si la empresa lo pide, el suplente."""
    config = config or configuracion_de(periodo.empresa)
    usuarios = [periodo.responsable]
    if config.copia_suplente:
        usuarios.append(periodo.suplente)
    return _sin_repetir(usuarios)


def destinatario_del_escalamiento(periodo) -> list[Destinatario]:
    """El supervisor o, si no hay, el aprobador (§12.2)."""
    return _sin_repetir([periodo.supervisor or periodo.aprobador])


# --- El correo -------------------------------------------------------------------------


def _enlace(periodo) -> str:
    """El detalle del período; exige iniciar sesión (§12.5)."""
    return (
        f"{settings.FRONTEND_URL.rstrip('/')}/admin/matriz/obligaciones"
        f"?periodo={periodo.id}&empresa={periodo.empresa_id}"
    )


#: Qué plantilla (`apps.correos`) usa cada tipo de aviso. El reenvío manual es
#: un recordatorio más.
CLAVE_DEL_TIPO = {
    TipoNotificacion.RECORDATORIO: "matriz.recordatorio",
    TipoNotificacion.MANUAL: "matriz.recordatorio",
    TipoNotificacion.VENCIMIENTO: "matriz.vencimiento",
    TipoNotificacion.ESCALAMIENTO: "matriz.escalamiento",
}


def variables(periodo, nombre: str, ahora=None) -> dict:
    """Las variables de los avisos de la Matriz para un período."""
    ahora = ahora or timezone.now()
    estado = estados.estado(periodo, ahora)
    obligacion = periodo.obligacion
    return {
        "nombre": nombre,
        "codigo": periodo.codigo,
        "obligacion": obligacion.nombre,
        "periodo": periodo.etiqueta,
        "empresa": periodo.empresa.nombre,
        "entidad": obligacion.entidad.nombre,
        "responsable": periodo.responsable.get_full_name() or periodo.responsable.username,
        "vencimiento": texto_de_vencimiento(periodo),
        "estado": estado["label"],
        "dias_atraso": str(estado["days_overdue"] or 0),
        "enlace": _enlace(periodo),
    }


def construir_correo(periodo, tipo, nombre: str, ahora=None) -> dict:
    """Asunto, texto y HTML de un aviso, sin enviarlo. Lo usan el envío y la
    vista previa, para que lo que se previsualiza sea exactamente lo que llega."""
    correo = servicio_de_correos.renderizar(CLAVE_DEL_TIPO[tipo], variables(periodo, nombre, ahora))
    return {"subject": correo["asunto"], "text": correo["texto"], "html": correo["html"]}


def vista_previa(periodo, tipo, ahora=None) -> dict:
    """`subject`, `to`, `text` y `html`, sin enviar nada (§12.5)."""
    lista = (
        destinatario_del_escalamiento(periodo)
        if tipo == TipoNotificacion.ESCALAMIENTO
        else destinatarios(periodo)
    )
    nombre = lista[0].nombre if lista else "—"
    return {"to": [d.correo for d in lista], **construir_correo(periodo, tipo, nombre, ahora)}


# --- Envío con deduplicación ------------------------------------------------------------


def _mandar(notificacion: Notificacion, ahora) -> bool:
    """Envía una notificación ya registrada y anota el resultado."""
    periodo = notificacion.periodo
    nombre = (
        notificacion.destinatario.get_full_name() or notificacion.destinatario.username
        if notificacion.destinatario
        else notificacion.correo
    )
    correo = construir_correo(periodo, notificacion.tipo, nombre, ahora)
    try:
        mensaje = EmailMultiAlternatives(
            subject=correo["subject"],
            body=correo["text"],
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[notificacion.correo],
        )
        mensaje.attach_alternative(correo["html"], "text/html")
        mensaje.send(fail_silently=False)
    except Exception as error:  # noqa: BLE001
        # Ningún fallo de SMTP debe tumbar el ciclo: se anota y se reintenta.
        logger.warning(
            "Matriz: falló el aviso %s a %s: %s", notificacion.clave, notificacion.correo, error
        )
        notificacion.estado = EstadoNotificacion.FALLIDO
        notificacion.ultimo_error = str(error)[:2000] or error.__class__.__name__
        notificacion.save(update_fields=["estado", "ultimo_error", "updated_at"])
        return False
    notificacion.estado = EstadoNotificacion.ENVIADO
    notificacion.ultimo_error = ""
    notificacion.enviado_en = timezone.now()
    notificacion.save(update_fields=["estado", "ultimo_error", "enviado_en", "updated_at"])
    return True


def _registrar_y_mandar(*, clave, ahora, **campos) -> Notificacion | None:
    """Crea la fila con su clave y envía. `None` si la clave ya existía: ese
    aviso ya salió (o lo está mandando otra pasada)."""
    try:
        with transaction.atomic():
            notificacion = Notificacion.objects.create(
                clave=clave, estado=EstadoNotificacion.FALLIDO, ultimo_error=EN_CURSO, **campos
            )
    except IntegrityError:
        return None
    _mandar(notificacion, ahora)
    return notificacion


# --- Los procesos programados -------------------------------------------------------------


def _abiertos():
    """Los períodos que todavía reciben avisos, de todas las empresas activas."""
    return (
        Periodo.objects.todas()
        .filter(cerrado=False, recordatorios_suspendidos=False, empresa__activa=True)
        .select_related(
            "empresa", "obligacion__entidad", "responsable", "suplente", "supervisor", "aprobador"
        )
    )


def enviar_recordatorios(ahora=None) -> int:
    """Los avisos de anticipación y del día del vencimiento (§12.1)."""
    ahora = ahora or timezone.now()
    enviados = 0
    configs = {}
    for periodo in _abiertos():
        config = configs.get(periodo.empresa_id) or configuracion_de(periodo.empresa)
        configs[periodo.empresa_id] = config
        hoy, hora = _hoy_y_hora(periodo.empresa, ahora)
        if hora < config.hora_envio:
            continue
        dia_vence = _dia_de_vencimiento(periodo)
        dias = (dia_vence - hoy).days
        if dias not in normalizar_anticipaciones(config.anticipaciones):
            continue
        tipo = TipoNotificacion.VENCIMIENTO if dias == 0 else TipoNotificacion.RECORDATORIO
        for destinatario in destinatarios(periodo, config):
            # La fecha de vencimiento va en la clave: si cambia, los avisos se
            # reprograman en vez de darse por enviados (§12.4).
            clave = f"auto:{periodo.id}:{tipo}:{dias}:{destinatario.correo}:{dia_vence}"
            if _registrar_y_mandar(
                clave=clave,
                ahora=ahora,
                periodo=periodo,
                tipo=tipo,
                anticipacion=dias,
                destinatario=destinatario.usuario,
                correo=destinatario.correo,
                programada_para=hoy,
            ):
                enviados += 1
    return enviados


def escalar_atrasos(ahora=None) -> int:
    """El aviso al supervisor (o al aprobador) por los atrasos (§12.2)."""
    ahora = ahora or timezone.now()
    enviados = 0
    configs = {}
    for periodo in _abiertos().filter(vence_en__lt=ahora):
        config = configs.get(periodo.empresa_id) or configuracion_de(periodo.empresa)
        configs[periodo.empresa_id] = config
        if not config.escalamiento_activo:
            continue
        hoy, hora = _hoy_y_hora(periodo.empresa, ahora)
        if hora < config.hora_envio:
            continue
        dia_vence = _dia_de_vencimiento(periodo)
        atraso = (hoy - dia_vence).days
        if atraso < config.dias_escalamiento:
            continue
        for destinatario in destinatario_del_escalamiento(periodo):
            base = f"esc:{periodo.id}:{destinatario.correo}:{dia_vence}"
            repetir = config.repetir_escalamiento_cada
            if repetir:
                ultimo = (
                    Notificacion.objects.todas()
                    .filter(clave__startswith=base, reintento_de__isnull=True)
                    .order_by("-programada_para")
                    .first()
                )
                if ultimo and (hoy - ultimo.programada_para).days < repetir:
                    continue
                clave = f"{base}:{hoy}"
            else:
                clave = base
            notificacion = _registrar_y_mandar(
                clave=clave,
                ahora=ahora,
                periodo=periodo,
                tipo=TipoNotificacion.ESCALAMIENTO,
                anticipacion=-atraso,
                destinatario=destinatario.usuario,
                correo=destinatario.correo,
                programada_para=hoy,
            )
            if notificacion:
                enviados += 1
                registrar_evento(
                    periodo,
                    None,
                    "reminder.escalated",
                    f"Escalamiento enviado a {destinatario.nombre}",
                    motivo=f"{atraso} día(s) de atraso",
                )
    return enviados


def reintentar(notificacion: Notificacion, actor=None, ahora=None) -> Notificacion:
    """Un intento nuevo de un aviso fallido (§12.3).

    Crea otra notificación (`reintento_de`, un intento más) y marca la original
    como reintentada: nunca se reescribe la original, para que el historial
    diga cuántas veces falló y por qué.
    """
    ahora = ahora or timezone.now()
    with transaction.atomic():
        original = Notificacion.objects.todas().select_for_update().get(pk=notificacion.pk)
        if original.estado != EstadoNotificacion.FALLIDO:
            raise ValueError("Solo se reintenta un aviso fallido.")
        nueva = Notificacion.objects.create(
            periodo=original.periodo,
            tipo=original.tipo,
            anticipacion=original.anticipacion,
            destinatario=original.destinatario,
            correo=original.correo,
            programada_para=original.programada_para,
            estado=EstadoNotificacion.FALLIDO,
            ultimo_error=EN_CURSO,
            intentos=original.intentos + 1,
            reintento_de=original,
            disparado_por=actor,
            clave=f"retry:{original.id}:{original.intentos + 1}",
        )
        original.estado = EstadoNotificacion.REINTENTADO
        original.save(update_fields=["estado", "updated_at"])
    _mandar(nueva, ahora)
    return nueva


def reintentar_fallidos(ahora=None) -> int:
    """Los fallidos que no llegaron al máximo de intentos (§12.3)."""
    pendientes = Notificacion.objects.todas().filter(
        estado=EstadoNotificacion.FALLIDO,
        intentos__lt=maximo_intentos(),
        periodo__cerrado=False,
        periodo__recordatorios_suspendidos=False,
    )
    total = 0
    for notificacion in pendientes.select_related("periodo__empresa"):
        try:
            reintentar(notificacion, ahora=ahora)
        except ValueError:
            # Otra pasada lo reintentó entre la consulta y el bloqueo.
            continue
        total += 1
    return total


def ciclo(ahora=None) -> dict:
    """Los procesos del programador, en orden (§13): primero se generan los
    períodos, para que los nuevos ya reciban sus avisos en la misma pasada."""
    from .generacion import generar_periodos

    ahora = ahora or timezone.now()
    return {
        "periodos": generar_periodos(ahora),
        "recordatorios": enviar_recordatorios(ahora),
        "escalamientos": escalar_atrasos(ahora),
        "reintentos": reintentar_fallidos(ahora),
    }


# --- A mano ------------------------------------------------------------------------------


def enviar_manual(*, periodo, actor, contexto=None) -> list[Notificacion]:
    """«Reenviar recordatorio»: siempre sale, aunque ya se haya enviado hoy."""
    ahora = timezone.now()
    hoy, _ = _hoy_y_hora(periodo.empresa, ahora)
    lista = destinatarios(periodo)
    if not lista:
        raise ValueError("Ni el responsable ni el suplente tienen un correo registrado.")
    enviadas = [
        _registrar_y_mandar(
            clave=f"manual:{uuid.uuid4()}",
            ahora=ahora,
            periodo=periodo,
            tipo=TipoNotificacion.MANUAL,
            destinatario=d.usuario,
            correo=d.correo,
            programada_para=hoy,
            disparado_por=actor,
        )
        for d in lista
    ]
    registrar_evento(
        periodo,
        actor,
        "reminder.sent",
        "Recordatorio reenviado",
        valor_nuevo=", ".join(d.correo for d in lista)[:255],
    )
    record_audit_event(
        actor=actor,
        action="reminder.sent",
        target=periodo,
        module="matriz",
        new_values={"destinatarios": [d.correo for d in lista]},
        context=contexto,
    )
    return enviadas


# --- Lo que se ve en el detalle -------------------------------------------------------------


def _llego(notificacion) -> bool:
    """Si el aviso terminó enviado, por sí o por alguno de sus reintentos."""
    if notificacion.estado == EstadoNotificacion.ENVIADO:
        return True
    return any(map(_llego, notificacion.reintentos.all()))


def programacion(periodo, ahora=None) -> list[dict]:
    """Por cada anticipación, su fecha y en qué quedó (§12.5)."""
    ahora = ahora or timezone.now()
    config = configuracion_de(periodo.empresa)
    hoy, hora = _hoy_y_hora(periodo.empresa, ahora)
    dia_vence = _dia_de_vencimiento(periodo)
    suspendido = periodo.cerrado or periodo.recordatorios_suspendidos
    automaticas = list(
        Notificacion.objects.todas().filter(
            periodo=periodo, clave__startswith=f"auto:{periodo.id}:"
        )
    )

    filas = []
    for dias in normalizar_anticipaciones(config.anticipaciones):
        tipo = TipoNotificacion.VENCIMIENTO if dias == 0 else TipoNotificacion.RECORDATORIO
        fecha = dia_vence - datetime.timedelta(days=dias)
        prefijo = f"auto:{periodo.id}:{tipo}:{dias}:"
        propias = [
            n
            for n in automaticas
            if n.clave.startswith(prefijo) and n.clave.endswith(f":{dia_vence}")
        ]
        if propias:
            situacion = "enviado" if any(map(_llego, propias)) else "fallido"
        elif suspendido:
            situacion = "suspendido"
        elif fecha > hoy or (fecha == hoy and hora < config.hora_envio):
            situacion = "programado"
        else:
            situacion = "no_enviado"
        filas.append(
            {
                "offset_days": dias,
                "kind": tipo,
                "date": fecha.isoformat(),
                "time": config.hora_envio.strftime("%H:%M"),
                "status": situacion,
            }
        )
    return filas
