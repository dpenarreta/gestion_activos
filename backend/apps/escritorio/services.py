"""Lógica de negocio del Escritorio, portada de Nexo (`apps.desk.services` y
las reglas que allá vivían en las vistas).

Se conserva de Nexo:

- **Notas**: una persona deja una nota a otra (prioridad, color, adjunto). El
  destinatario la lee (al remitente le llega el aviso), la fija y la archiva;
  los dos responden, hasta `RESPUESTAS_MAX` respuestas por nota. El remitente
  la manda a la papelera; el destinatario solo puede eliminar definitivamente
  una que ya archivó. El archivo se purga solo a los `RETENCION_ARCHIVO_DIAS`.
- **Nota → recordatorio**: solo el destinatario, una vez; la nota no cambia y
  el recordatorio se lleva una copia del adjunto. Las prioridades se traducen
  (`NOTA_A_RECORDATORIO`).
- **Recordatorios**: crear, editar, completar (si se repite, nace la siguiente
  ocurrencia), posponer, reabrir un completado, archivar y eliminar. El aviso
  del vencimiento va UNA vez por vencimiento (`notified`).
- **Recordatorio → tarea**: una vez, con `TaskService.create_task` de Tareas,
  asignada a uno mismo; URGENTE pasa a ALTA (Tareas no tiene cuarto nivel).
- **La bitácora** de cada nota y recordatorio (`DeskAuditLog`).

Lo que cambia, documentado donde ocurre:

1. **El aviso de los vencidos corre solo**: en Nexo se avisaba al abrir el
   escritorio (si nadie lo abría, nadie se enteraba). Aquí lo hace también el
   comando `ciclo_escritorio` cada cinco minutos (`scripts/tarea_respaldo.py`),
   junto con las purgas. El aviso se reserva fila por fila
   (`notified=False → True` con un `UPDATE` condicionado): dos pasadas a la vez
   no avisan dos veces.
2. **Ajustes fijos**: Nexo los leía de su configuración del sistema; aquí son
   los valores de fábrica de Nexo como constantes (`RESPUESTAS_MAX`,
   `RETENCION_ARCHIVO_DIAS`, `RETENCION_PAPELERA_HORAS`, `POSPONER_MINUTOS`), y
   la pantalla los recibe en `me/`.
3. **Idempotencia**: fijar, archivar y leer lo que ya está así no hace nada ni
   ensucia la bitácora; completar un completado o convertir lo ya convertido
   responde 409 (un doble clic no crea dos ocurrencias ni dos tareas). La fila
   se bloquea mientras dura cada cambio.
4. **Adjuntos** como archivos validados (los mismos formatos y tope de Nexo,
   con las reglas de `apps.mejora_continua.services`) y que se ven dentro del
   sistema. El recordatorio también muestra el suyo (en Nexo no se podía abrir).
5. **Destinatarios** (ver `access.destinatarios`).

Las vistas solo resuelven parámetros y delegan aquí.
"""

import calendar
import logging
from datetime import datetime, timedelta
from pathlib import PurePath

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.busqueda import condicion_de_busqueda, filtro_de_busqueda
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.mejora_continua import services as adjuntos_comunes
from apps.tasks.roles import gh_role_of, role_label

from . import access
from .models import (
    TITULO_MAX,
    DeskAuditAction,
    DeskAuditLog,
    DeskNote,
    DeskNoteReply,
    PersonalReminder,
)

logger = logging.getLogger(__name__)
User = get_user_model()

NOTA = DeskAuditLog.EntityType.NOTE
RECORDATORIO = DeskAuditLog.EntityType.REMINDER

#: Respuestas por nota (`DEFAULT_DESK_NOTE_MAX_REPLIES` de Nexo).
RESPUESTAS_MAX = 2
#: Días que una nota archivada se conserva antes de purgarse
#: (`DEFAULT_DESK_ARCHIVE_RETENTION_DAYS` de Nexo).
RETENCION_ARCHIVO_DIAS = 15
#: Horas que una nota pasa en la papelera de su remitente antes de borrarse
#: (`DEFAULT_RECOVERY_RETENTION_HOURS` del Centro de Recuperación de Nexo).
RETENCION_PAPELERA_HORAS = 48
#: Atajos de «posponer» (`DEFAULT_SNOOZE_PRESETS_MINUTES` de Nexo).
POSPONER_MINUTOS = [15, 30, 60, 1440]
DESCRIPCION_MAX = 5000
LISTA_MAX = 200

#: Las acciones del destinatario sobre su nota (`ACTIONS` de Nexo).
ACCIONES_DE_NOTA = ("read", "pin", "unpin", "archive", "unarchive")
BITACORA_DE_ACCION = {
    "read": DeskAuditAction.READ,
    "pin": DeskAuditAction.PINNED,
    "unpin": DeskAuditAction.UNPINNED,
    "archive": DeskAuditAction.ARCHIVED,
    "unarchive": DeskAuditAction.UNARCHIVED,
}

#: Las acciones sobre un recordatorio (las ramas de `PATCH` de Nexo).
COMPLETAR = "complete"
POSPONER = "postpone"
REABRIR = "reopen"
ARCHIVAR = "archive"
DESARCHIVAR = "unarchive"
ACCIONES_DE_RECORDATORIO = (COMPLETAR, POSPONER, REABRIR, ARCHIVAR, DESARCHIVAR)

#: Escala de la nota → escala del recordatorio (`PRIORITY_MAP` de Nexo).
NOTA_A_RECORDATORIO = {
    DeskNote.Priority.INFORMACION: PersonalReminder.Priority.BAJA,
    DeskNote.Priority.RECORDATORIO: PersonalReminder.Priority.MEDIA,
    DeskNote.Priority.IMPORTANTE: PersonalReminder.Priority.ALTA,
    DeskNote.Priority.URGENTE: PersonalReminder.Priority.URGENTE,
}

#: Adónde llevan los avisos de la campana (ruta del frontend).
ENLACE_ESCRITORIO = "/admin/gestion-humana/escritorio"
AVISO_MAX = 300

TITULOS_DE_AVISO = {
    "nota": "Escritorio: le dejaron una nota",
    "leida": "Escritorio: leyeron su nota",
    "respuesta": "Escritorio: respondieron una nota",
    "recordatorio": "Escritorio: recordatorio vencido",
}

# Los formatos y el tope de los adjuntos son los de Nexo (`src/lib/storage.ts`),
# los mismos que valida Mejora continua.
FORMATOS_DE_ADJUNTO = adjuntos_comunes.FORMATOS_DE_ADJUNTO
TAMANO_MAXIMO_ADJUNTO = adjuntos_comunes.TAMANO_MAXIMO_ADJUNTO
visor_de = adjuntos_comunes.visor_de


class EscritorioError(Exception):
    """Error de negocio controlado: la vista lo traduce al contrato de error
    uniforme (`{"error": {"code", "message", "details"}}`)."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "validation_error",
        status: int = 400,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details


def _invalido(campo: str, mensaje: str) -> EscritorioError:
    return EscritorioError(mensaje, details={campo: [mensaje]})


def _prohibido(mensaje: str) -> EscritorioError:
    return EscritorioError(mensaje, code="permission_denied", status=403)


def _conflicto(mensaje: str) -> EscritorioError:
    return EscritorioError(mensaje, code="conflict", status=409)


def _nota_no_encontrada() -> EscritorioError:
    return EscritorioError("Nota no encontrada.", code="not_found", status=404)


def _recordatorio_no_encontrado() -> EscritorioError:
    return EscritorioError("Recordatorio no encontrado.", code="not_found", status=404)


def nombre_corto(user) -> str:
    """El nombre corto de Nexo (`first_name or username`)."""
    return (user.first_name or "").strip() or user.username


def _empresa_activa():
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        raise EscritorioError("No hay una empresa activa.", code="sin_empresa")
    return empresa


def describir_personas(personas) -> dict[int, dict]:
    """La referencia de cada persona: id, nombres y su rol de Gestión Humana.
    Sin el correo."""
    unicas = {p.pk: p for p in personas if p is not None}
    resultado = {}
    for pk, persona in unicas.items():
        rol = gh_role_of(persona)
        resultado[pk] = {
            "id": pk,
            "name": nombre_corto(persona),
            "full_name": (persona.get_full_name() or "").strip() or persona.username,
            "role": rol or None,
            "role_label": role_label(rol) if rol else None,
        }
    return resultado


def resumen_de_acceso(user) -> dict:
    """`GET /escritorio/me/`: qué puede hacer la persona, los ajustes del
    módulo y cuántas notas tiene sin leer."""
    return {
        "user_id": user.pk,
        "permissions": access.effective_codenames(user),
        "can_convert_to_task": access.puede_convertir_en_tarea(user),
        "unread_notes": notas_sin_leer(user),
        "settings": {
            "max_replies": RESPUESTAS_MAX,
            "archive_retention_days": RETENCION_ARCHIVO_DIAS,
            "trash_retention_hours": RETENCION_PAPELERA_HORAS,
            "snooze_presets_minutes": list(POSPONER_MINUTOS),
        },
        "attachment": {
            "extensions": sorted(FORMATOS_DE_ADJUNTO),
            "max_bytes": TAMANO_MAXIMO_ADJUNTO,
        },
        "choices": {
            "note_priority": [{"value": v, "label": e} for v, e in DeskNote.Priority.choices],
            "note_color": [{"value": v, "label": e} for v, e in DeskNote.Color.choices],
            "reminder_priority": [
                {"value": v, "label": e} for v, e in PersonalReminder.Priority.choices
            ],
            "reminder_status": [
                {"value": v, "label": e} for v, e in PersonalReminder.Status.choices
            ],
            "reminder_repeat": [
                {"value": v, "label": e} for v, e in PersonalReminder.Repeat.choices
            ],
        },
    }


# ── Bitácora y avisos ─────────────────────────────────────────────────────────


def registrar(*, entity_type, entity_id, user, action, metadata=None, empresa=None) -> None:
    """Una entrada de la bitácora. Nunca tumba la acción que registra (como
    `logDeskAudit` de Nexo): va en su propio punto de guardado, para que un
    fallo aquí no deje inservible la transacción de afuera."""
    try:
        with transaction.atomic():
            DeskAuditLog.objects.create(
                empresa=empresa,
                entity_type=entity_type,
                entity_id=entity_id,
                user=user,
                action=action,
                metadata=metadata,
            )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo registrar el evento del escritorio")


def _avisar(destinatarios, *, categoria: str, resumen: str, empresa, enlace: str = ""):
    """Aviso en la campana, después de confirmar: si la campana falla, la
    operación no se revierte."""
    personas = [u for u in destinatarios if u is not None]
    if not personas:
        return
    texto = resumen if len(resumen) <= AVISO_MAX else resumen[: AVISO_MAX - 1] + "…"

    def enviar():
        from apps.notificaciones.services import notificar

        notificar(
            personas,
            tipo=f"escritorio.{categoria}",
            titulo=TITULOS_DE_AVISO[categoria],
            resumen=texto,
            enlace=enlace or ENLACE_ESCRITORIO,
            empresa=empresa,
        )

    transaction.on_commit(enviar)


# ── Adjuntos ──────────────────────────────────────────────────────────────────


def validar_adjunto(archivo) -> str:
    """Valida el adjunto como Mejora continua (tamaño de Nexo, extensión, firma
    y, en un OOXML, su índice) y devuelve el tipo que le corresponde."""
    try:
        _, mime = adjuntos_comunes.validar_adjunto(archivo)
    except adjuntos_comunes.MejoraContinuaError as exc:
        raise EscritorioError(exc.message, details={"attachment": [exc.message]}) from exc
    return mime


def archivo_desde_base64(nombre: str, datos: str) -> ContentFile:
    """El base64 de Nexo como archivo (lo usa la importación)."""
    try:
        return adjuntos_comunes.archivo_desde_base64(nombre, datos)
    except adjuntos_comunes.MejoraContinuaError as exc:
        raise EscritorioError(exc.message, details={"attachment": [exc.message]}) from exc


def _nombre_de_archivo(nombre: str) -> str:
    """Solo el nombre, sin carpetas (el navegador puede mandar una ruta)."""
    return (PurePath(nombre or "").name or "adjunto")[:255]


def _guardar_adjunto(objeto, archivo, mime: str) -> None:
    objeto.attachment_name = _nombre_de_archivo(archivo.name)
    objeto.attachment_mime = mime
    objeto.attachment_size = archivo.size
    objeto.attachment.save(objeto.attachment_name, archivo, save=False)


def _borrar_archivo_al_confirmar(campo) -> None:
    """Borra el archivo solo si la transacción se confirma: si se deshace, la
    fila vuelve y su archivo tiene que seguir ahí."""
    if not campo:
        return
    nombre, almacenamiento = campo.name, campo.storage

    def borrar():
        try:
            almacenamiento.delete(nombre)
        except OSError:
            logger.warning("No se pudo borrar el adjunto %s del escritorio", nombre)

    transaction.on_commit(borrar)


def adjunto(objeto, url: str) -> dict | None:
    if not objeto.attachment:
        return None
    return {
        "name": objeto.attachment_name,
        "mime": objeto.attachment_mime,
        "size": objeto.attachment_size,
        "viewer": visor_de(objeto.attachment_mime),
        "url": url,
    }


# ── Notas: lectura ────────────────────────────────────────────────────────────


def notas_vigentes():
    """Las notas de la empresa activa que no están en la papelera."""
    return DeskNote.objects.filter(deleted_at__isnull=True)


def notas_de(user):
    """Las notas en que participa `user` (remitente o destinatario)."""
    return notas_vigentes().filter(Q(sender_id=user.pk) | Q(recipient_id=user.pk))


def notas_sin_leer(user) -> int:
    return notas_vigentes().filter(recipient_id=user.pk, read=False, archived=False).count()


def obtener_nota(actor, pk, *, bloquear: bool = False) -> DeskNote:
    """La nota si existe en la empresa activa, no está en la papelera y
    `actor` participa; si no, 404 (no se revela que existe)."""
    consulta = notas_de(actor).filter(pk=pk)
    if bloquear:
        consulta = consulta.select_for_update()
    else:
        consulta = consulta.select_related("sender", "recipient")
    nota = consulta.first()
    if nota is None:
        raise _nota_no_encontrada()
    return nota


def otra_parte_id(actor, nota: DeskNote) -> int:
    return nota.recipient_id if actor.pk == nota.sender_id else nota.sender_id


# ── Notas: escritura ──────────────────────────────────────────────────────────


def crear_nota(
    *, actor, recipient_id: int, message: str, priority: str, color: str, adjunto_=None
) -> DeskNote:
    """Réplica de `POST /desk-notes`: valida el destinatario y el adjunto,
    guarda, deja la bitácora y avisa al destinatario."""
    empresa = _empresa_activa()
    if recipient_id == actor.pk:
        raise _invalido("recipient", "No puede dejarse una nota a sí mismo.")
    destinatario = access.destinatarios(actor).filter(pk=recipient_id).first()
    if destinatario is None:
        raise _invalido(
            "recipient", "No puede dejarle una nota a esta persona: no tiene acceso al Escritorio."
        )
    mime = validar_adjunto(adjunto_) if adjunto_ is not None else ""

    nota = DeskNote(
        empresa=empresa,
        sender=actor,
        recipient=destinatario,
        message=message,
        priority=priority,
        color=color,
    )
    try:
        with transaction.atomic():
            if adjunto_ is not None:
                _guardar_adjunto(nota, adjunto_, mime)
            nota.save()
            registrar(
                entity_type=NOTA,
                entity_id=nota.pk,
                user=actor,
                action=DeskAuditAction.CREATED,
                empresa=empresa,
            )
            _avisar(
                [destinatario],
                categoria="nota",
                resumen=f"{nombre_corto(actor)} dejó una nota en su escritorio",
                empresa=empresa,
            )
    except Exception:
        # Si la fila no se confirmó, el archivo ya escrito no puede quedar
        # huérfano en el almacenamiento.
        if nota.attachment:
            nota.attachment.delete(save=False)
        raise
    return nota


def accion_de_nota(*, actor, pk, action: str) -> DeskNote:
    """Réplica de `PATCH /desk-notes/[id]`: solo el destinatario (es su
    escritorio). Lo que ya está así no cambia ni deja bitácora."""
    if action not in ACCIONES_DE_NOTA:
        raise _invalido("action", "Acción inválida.")
    with transaction.atomic():
        nota = obtener_nota(actor, pk, bloquear=True)
        if nota.recipient_id != actor.pk:
            raise _prohibido("Solo quien recibió la nota puede hacer esto.")
        ahora = timezone.now()
        if action == "read":
            if nota.read:
                return nota
            nota.read, nota.read_at = True, ahora
            campos = ["read", "read_at"]
        elif action in ("pin", "unpin"):
            fijar = action == "pin"
            if nota.pinned == fijar:
                return nota
            nota.pinned = fijar
            campos = ["pinned"]
        else:
            archivar = action == "archive"
            if nota.archived == archivar:
                return nota
            nota.archived, nota.archived_at = archivar, ahora if archivar else None
            campos = ["archived", "archived_at"]
        nota.save(update_fields=[*campos, "updated_at"])
        registrar(
            entity_type=NOTA,
            entity_id=nota.pk,
            user=actor,
            action=BITACORA_DE_ACCION[action],
            empresa=nota.empresa,
        )
        if action == "read":
            _avisar(
                [nota.sender],
                categoria="leida",
                resumen=f"{nombre_corto(actor)} leyó su nota",
                empresa=nota.empresa,
            )
    return nota


def eliminar_nota(*, actor, pk) -> None:
    """Réplica de `DELETE /desk-notes/[id]`:

    - el remitente la manda a la papelera: nadie la vuelve a ver y se borra del
      todo a las `RETENCION_PAPELERA_HORAS` (`purgar`);
    - el destinatario solo puede eliminar definitivamente una que ya archivó
      (409 si no)."""
    with transaction.atomic():
        nota = obtener_nota(actor, pk, bloquear=True)
        if nota.sender_id == actor.pk:
            nota.deleted_at = timezone.now()
            nota.save(update_fields=["deleted_at", "updated_at"])
            registrar(
                entity_type=NOTA,
                entity_id=nota.pk,
                user=actor,
                action=DeskAuditAction.DELETED,
                metadata={"origin": "manual", "actor": "sender"},
                empresa=nota.empresa,
            )
            return
        if not nota.archived:
            raise _conflicto("Solo puede eliminar definitivamente una nota ya archivada.")
        _borrar_nota(nota, user=actor, metadata={"origin": "manual", "actor": "recipient"})


def _borrar_nota(nota: DeskNote, *, user, metadata: dict) -> None:
    """Borrado definitivo, con su archivo (al confirmar) y su bitácora."""
    pk, empresa = nota.pk, nota.empresa
    _borrar_archivo_al_confirmar(nota.attachment)
    nota.delete()
    registrar(
        entity_type=NOTA,
        entity_id=pk,
        user=user,
        action=DeskAuditAction.DELETED,
        metadata=metadata,
        empresa=empresa,
    )


def responder(*, actor, pk, message: str) -> DeskNoteReply:
    """Réplica de `POST /desk-notes/[id]/replies`: cualquiera de los dos
    participantes, hasta `RESPUESTAS_MAX` por nota (409 al llegar). La nota se
    bloquea mientras se cuenta: dos respuestas a la vez no pasan el tope."""
    with transaction.atomic():
        nota = obtener_nota(actor, pk, bloquear=True)
        if nota.replies.count() >= RESPUESTAS_MAX:
            raise _conflicto("Esta conversación alcanzó el límite permitido.")
        respuesta = DeskNoteReply.objects.create(note=nota, author=actor, message=message)
        registrar(
            entity_type=NOTA,
            entity_id=nota.pk,
            user=actor,
            action=DeskAuditAction.REPLIED,
            empresa=nota.empresa,
        )
        _avisar(
            [User.objects.get(pk=otra_parte_id(actor, nota))],
            categoria="respuesta",
            resumen=f"{nombre_corto(actor)} respondió su nota",
            empresa=nota.empresa,
        )
    return respuesta


def _titulo_desde_mensaje(mensaje: str) -> str:
    if len(mensaje) <= TITULO_MAX:
        return mensaje
    return mensaje[: TITULO_MAX - 1] + "…"


def _copiar_adjunto(origen, destino) -> None:
    """Copia el archivo de `origen` a `destino` (un archivo nuevo, no el
    mismo): cada uno vive y se borra por su lado."""
    if not origen.attachment:
        return
    with origen.attachment.open("rb") as archivo:
        contenido = archivo.read()
    destino.attachment_name = origen.attachment_name
    destino.attachment_mime = origen.attachment_mime
    destino.attachment_size = len(contenido)
    destino.attachment.save(origen.attachment_name or "adjunto", ContentFile(contenido), save=False)


def convertir_en_recordatorio(
    *, actor, pk, due_at, title: str = "", priority: str | None = None
) -> PersonalReminder:
    """Réplica de `POST /desk-notes/[id]/convert-to-reminder`: solo el
    destinatario y una vez (409). Sin título, el del mensaje; sin prioridad, la
    traducida de la nota. La nota no cambia: solo queda marcada."""
    recordatorio = None
    try:
        with transaction.atomic():
            nota = obtener_nota(actor, pk, bloquear=True)
            if nota.recipient_id != actor.pk:
                raise _prohibido("Solo quien recibió la nota puede convertirla en recordatorio.")
            if nota.converted_to_reminder_id or nota.converted_at:
                raise _conflicto("Esta nota ya fue convertida en recordatorio.")
            recordatorio = PersonalReminder(
                empresa=nota.empresa,
                user=actor,
                title=(title or "").strip() or _titulo_desde_mensaje(nota.message),
                description=nota.message,
                due_at=due_at,
                priority=priority or NOTA_A_RECORDATORIO[nota.priority],
            )
            _copiar_adjunto(nota, recordatorio)
            recordatorio.save()
            nota.converted_to_reminder = recordatorio
            nota.converted_at = timezone.now()
            nota.save(update_fields=["converted_to_reminder", "converted_at", "updated_at"])
            registrar(
                entity_type=NOTA,
                entity_id=nota.pk,
                user=actor,
                action=DeskAuditAction.CONVERTED_TO_REMINDER,
                metadata={"reminderId": recordatorio.pk},
                empresa=nota.empresa,
            )
            registrar(
                entity_type=RECORDATORIO,
                entity_id=recordatorio.pk,
                user=actor,
                action=DeskAuditAction.CREATED,
                metadata={"convertedFromNoteId": nota.pk},
                empresa=nota.empresa,
            )
    except Exception:
        # La transacción se deshizo: la copia del adjunto no puede quedar
        # huérfana en el almacenamiento.
        if recordatorio is not None and recordatorio.attachment:
            recordatorio.attachment.delete(save=False)
        raise
    return recordatorio


# ── Recordatorios ─────────────────────────────────────────────────────────────


def recordatorios_de(user):
    return PersonalReminder.objects.filter(user_id=user.pk)


def obtener_recordatorio(actor, pk, *, bloquear: bool = False) -> PersonalReminder:
    """El recordatorio si es de `actor` en la empresa activa; si no, 404 (como
    en Nexo, no se revela que existe)."""
    consulta = recordatorios_de(actor).filter(pk=pk)
    if bloquear:
        consulta = consulta.select_for_update()
    recordatorio = consulta.first()
    if recordatorio is None:
        raise _recordatorio_no_encontrado()
    return recordatorio


def siguiente_ocurrencia(due_at: datetime, repeat: str) -> datetime:
    """La próxima ocurrencia, conservando la hora (`advanceRepeat` de Nexo).
    En MENSUAL, el día que no existe en el mes siguiente se ajusta a su último
    día (31 de enero → 28 o 29 de febrero), como en la versión de Django de
    Nexo."""
    if repeat == PersonalReminder.Repeat.DIARIO:
        return due_at + timedelta(days=1)
    if repeat == PersonalReminder.Repeat.SEMANAL:
        return due_at + timedelta(days=7)
    if repeat == PersonalReminder.Repeat.MENSUAL:
        anio = due_at.year + (due_at.month // 12)
        mes = due_at.month % 12 + 1
        ultimo = calendar.monthrange(anio, mes)[1]
        return due_at.replace(year=anio, month=mes, day=min(due_at.day, ultimo))
    return due_at


def crear_recordatorio(
    *, actor, title: str, due_at, description: str = "", priority: str, repeat: str
) -> PersonalReminder:
    """Réplica de `POST /desk-reminders`."""
    empresa = _empresa_activa()
    with transaction.atomic():
        recordatorio = PersonalReminder.objects.create(
            empresa=empresa,
            user=actor,
            title=title,
            description=(description or "").strip() or None,
            due_at=due_at,
            priority=priority,
            repeat=repeat,
        )
        registrar(
            entity_type=RECORDATORIO,
            entity_id=recordatorio.pk,
            user=actor,
            action=DeskAuditAction.CREATED,
            empresa=empresa,
        )
    return recordatorio


def _registrar_recordatorio(recordatorio, actor, accion, metadata=None):
    registrar(
        entity_type=RECORDATORIO,
        entity_id=recordatorio.pk,
        user=actor,
        action=accion,
        metadata=metadata,
        empresa=recordatorio.empresa,
    )


def accion_de_recordatorio(*, actor, pk, action: str, due_at=None) -> PersonalReminder:
    """Las ramas con `action` de `PATCH /desk-reminders/[id]`."""
    if action not in ACCIONES_DE_RECORDATORIO:
        raise _invalido("action", "Acción inválida.")
    with transaction.atomic():
        r = obtener_recordatorio(actor, pk, bloquear=True)
        if action == COMPLETAR:
            return _completar(actor, r)
        if action == POSPONER:
            if due_at is None:
                raise _invalido("due_at", "Indique hasta cuándo se pospone.")
            previo = r.due_at
            r.due_at, r.status, r.completed_at, r.notified = (
                due_at,
                PersonalReminder.Status.PENDIENTE,
                None,
                False,
            )
            r.save(update_fields=["due_at", "status", "completed_at", "notified", "updated_at"])
            _registrar_recordatorio(
                r,
                actor,
                DeskAuditAction.POSTPONED,
                {"from": previo.isoformat(), "to": due_at.isoformat()},
            )
            return r
        if action == REABRIR:
            if r.status != PersonalReminder.Status.COMPLETADO:
                raise _conflicto("Solo se puede reabrir un recordatorio completado.")
            previo = r.due_at
            r.status, r.completed_at, r.archived, r.archived_at, r.notified = (
                PersonalReminder.Status.PENDIENTE,
                None,
                False,
                None,
                False,
            )
            campos = ["status", "completed_at", "archived", "archived_at", "notified"]
            if due_at is not None:
                r.due_at = due_at
                campos.append("due_at")
            r.save(update_fields=[*campos, "updated_at"])
            _registrar_recordatorio(r, actor, DeskAuditAction.REOPENED)
            if due_at is not None:
                _registrar_recordatorio(
                    r,
                    actor,
                    DeskAuditAction.POSTPONED,
                    {"from": previo.isoformat(), "to": due_at.isoformat()},
                )
            return r
        archivar = action == ARCHIVAR
        if r.archived == archivar:
            return r
        r.archived, r.archived_at = archivar, timezone.now() if archivar else None
        r.save(update_fields=["archived", "archived_at", "updated_at"])
        _registrar_recordatorio(
            r, actor, DeskAuditAction.ARCHIVED if archivar else DeskAuditAction.UNARCHIVED
        )
        return r


def _completar(actor, r: PersonalReminder) -> PersonalReminder:
    """Completa y, si se repite, crea la siguiente ocurrencia. Completar uno ya
    completado es 409: un doble clic no puede crear dos ocurrencias."""
    if r.status == PersonalReminder.Status.COMPLETADO:
        raise _conflicto("Este recordatorio ya está completado.")
    r.status, r.completed_at = PersonalReminder.Status.COMPLETADO, timezone.now()
    r.save(update_fields=["status", "completed_at", "updated_at"])
    _registrar_recordatorio(r, actor, DeskAuditAction.COMPLETED)
    if r.repeat != PersonalReminder.Repeat.UNA_VEZ:
        siguiente = PersonalReminder.objects.create(
            empresa=r.empresa,
            user=actor,
            title=r.title,
            description=r.description,
            due_at=siguiente_ocurrencia(r.due_at, r.repeat),
            priority=r.priority,
            repeat=r.repeat,
        )
        _registrar_recordatorio(
            siguiente, actor, DeskAuditAction.CREATED, {"nextOccurrenceOf": r.pk}
        )
    return r


def editar_recordatorio(*, actor, pk, cambios: dict) -> PersonalReminder:
    """La edición directa de `PATCH /desk-reminders/[id]` (sin `action`). Si
    cambia la prioridad deja PRIORITY_CHANGED; si no, EDITED. Mover la fecha
    rearma el aviso. Sin cambios reales, no hace nada."""
    with transaction.atomic():
        r = obtener_recordatorio(actor, pk, bloquear=True)
        if "description" in cambios:
            cambios["description"] = (cambios["description"] or "").strip() or None
        cambiados = {c: v for c, v in cambios.items() if getattr(r, c) != v}
        if not cambiados:
            return r
        prioridad_previa = r.priority
        for campo, valor in cambiados.items():
            setattr(r, campo, valor)
        campos = list(cambiados)
        if "due_at" in cambiados:
            r.notified = False
            campos.append("notified")
        r.save(update_fields=[*campos, "updated_at"])
        if "priority" in cambiados:
            _registrar_recordatorio(
                r,
                actor,
                DeskAuditAction.PRIORITY_CHANGED,
                {"from": prioridad_previa, "to": r.priority},
            )
        else:
            _registrar_recordatorio(r, actor, DeskAuditAction.EDITED)
    return r


def eliminar_recordatorio(*, actor, pk) -> None:
    """Réplica de `DELETE /desk-reminders/[id]`: lo borra con su archivo (al
    confirmar) y deja la bitácora. La nota de la que salió no cambia."""
    with transaction.atomic():
        r = obtener_recordatorio(actor, pk, bloquear=True)
        recordatorio_id, empresa = r.pk, r.empresa
        _borrar_archivo_al_confirmar(r.attachment)
        r.delete()
        registrar(
            entity_type=RECORDATORIO,
            entity_id=recordatorio_id,
            user=actor,
            action=DeskAuditAction.DELETED,
            empresa=empresa,
        )


#: Escala del recordatorio → escala de Tareas (`PRIORITY_MAP` de Nexo).
RECORDATORIO_A_TAREA = {
    PersonalReminder.Priority.URGENTE: "ALTA",
    PersonalReminder.Priority.ALTA: "ALTA",
    PersonalReminder.Priority.MEDIA: "MEDIA",
    PersonalReminder.Priority.BAJA: "BAJA",
}


def convertir_en_tarea(
    *,
    actor,
    pk,
    start_date,
    end_date,
    estimated_hours: float,
    title: str = "",
    type: str,  # noqa: A002 (nombre del campo de Tareas)
    frequency: str,
    context=None,
):
    """Réplica de `POST /desk-reminders/[id]/convert-to-task`: crea la tarea en
    Tareas con su servicio (sus reglas y su auditoría), asignada a uno mismo, y
    marca el recordatorio. Una vez (409). Pide `tareas.acceder`."""
    from apps.tasks.services import TareasError, TaskService

    if not access.puede_convertir_en_tarea(actor):
        raise _prohibido("No tiene acceso a Tareas: no puede convertir el recordatorio en tarea.")
    with transaction.atomic():
        r = obtener_recordatorio(actor, pk, bloquear=True)
        if r.converted_to_task_id or r.converted_to_task_at:
            raise _conflicto("Este recordatorio ya fue convertido en tarea.")
        descripcion = r.description or ""
        if r.attachment_name:
            # La tarea no tiene adjunto: se nombra el del recordatorio, que es
            # donde sigue (como en Nexo).
            descripcion = (
                f"{descripcion}\n\nAdjunto en el recordatorio: {r.attachment_name}"
            ).strip()
        try:
            tarea = TaskService.create_task(
                actor=actor,
                context=context,
                title=(title or "").strip() or r.title,
                description=descripcion,
                type=type,
                status="PENDIENTE",
                priority=RECORDATORIO_A_TAREA[r.priority],
                frequency=frequency,
                start_date=start_date,
                end_date=end_date,
                estimated_hours=estimated_hours,
                assigned_to=actor,
            )
        except TareasError as exc:
            raise EscritorioError(
                exc.message, code=exc.code, status=exc.status, details=exc.details
            ) from exc
        r.converted_to_task = tarea
        r.converted_to_task_at = timezone.now()
        r.save(update_fields=["converted_to_task", "converted_to_task_at", "updated_at"])
        _registrar_recordatorio(r, actor, DeskAuditAction.CONVERTED_TO_TASK, {"taskId": tarea.pk})
    return tarea


# ── El ciclo: avisos de vencidos y purgas ─────────────────────────────────────


def avisar_vencidos(*, user=None, ahora=None) -> int:
    """Avisa en la campana cada recordatorio pendiente ya vencido del que no se
    avisó (`notifyDueReminders` de Nexo). Con `user`, solo los suyos (al abrir
    el escritorio); sin él, los de todas las empresas (el ciclo). Cada aviso se
    reserva con un `UPDATE` condicionado: si otra pasada lo tomó primero, este
    no avisa. Devuelve cuántos avisó."""
    ahora = ahora or timezone.now()
    consulta = PersonalReminder.objects.todas().filter(
        status=PersonalReminder.Status.PENDIENTE, notified=False, due_at__lte=ahora
    )
    if user is not None:
        consulta = consulta.filter(user_id=user.pk)
    avisados = 0
    for r in consulta.select_related("user", "empresa").order_by("due_at", "id"):
        reservado = (
            PersonalReminder.objects.todas().filter(pk=r.pk, notified=False).update(notified=True)
        )
        if not reservado:
            continue
        avisados += 1
        _avisar(
            [r.user],
            categoria="recordatorio",
            resumen=f"Recordatorio: «{r.title}»",
            empresa=r.empresa,
            enlace=f"{ENLACE_ESCRITORIO}?recordatorio={r.pk}",
        )
    return avisados


def purgar(*, ahora=None, simular: bool = False) -> dict:
    """Las dos retenciones de Nexo, en todas las empresas:

    - el archivo del destinatario: la nota archivada hace más de
      `RETENCION_ARCHIVO_DIAS` se borra (`purgeExpiredArchivedNotes`);
    - la papelera del remitente: la nota que mandó a la papelera hace más de
      `RETENCION_PAPELERA_HORAS` se borra (el Centro de Recuperación).

    Cada borrado deja su entrada en la bitácora (sin persona: lo hizo el
    sistema). Sin nada vencido son dos consultas."""
    ahora = ahora or timezone.now()
    archivo = DeskNote.objects.todas().filter(
        archived=True,
        archived_at__lte=ahora - timedelta(days=RETENCION_ARCHIVO_DIAS),
        deleted_at__isnull=True,
    )
    papelera = DeskNote.objects.todas().filter(
        deleted_at__lte=ahora - timedelta(hours=RETENCION_PAPELERA_HORAS)
    )
    resumen = {"archived": archivo.count(), "trashed": papelera.count()}
    if simular:
        return resumen
    for consulta, motivo in (
        (archivo, "archive_retention_expired"),
        (papelera, "trash_retention_expired"),
    ):
        for nota in consulta.select_related("empresa"):
            with transaction.atomic():
                _borrar_nota(nota, user=None, metadata={"origin": "automatic", "reason": motivo})
    return resumen


def ciclo(*, ahora=None) -> dict:
    """Lo que corre cada cinco minutos (`manage.py ciclo_escritorio`)."""
    ahora = ahora or timezone.now()
    avisados = avisar_vencidos(ahora=ahora)
    purgadas = purgar(ahora=ahora)
    return {"notified": avisados, **purgadas}


# ── Hoy y el buscador ─────────────────────────────────────────────────────────

#: Ventanas de la bandeja «Hoy» (las de Nexo).
DIAS_DE_TAREAS_PROXIMAS = 7
DIAS_DE_PROYECTOS_RECIENTES = 7
BLOQUE_MAX = 8
RESULTADOS_MAX = 50


def hoy(user, *, ahora=None) -> dict:
    """La bandeja «Hoy» de Nexo (`GET /api/desk/today`): las notas sin leer, los
    recordatorios pendientes hasta el fin del día, las tareas que vencen en la
    semana y los proyectos con actividad reciente. Los dos últimos bloques solo
    si la persona entra a Tareas o a Proyectos (si no, `null`): el escritorio no
    abre una puerta a otro módulo."""
    from apps.permissions.authorization import user_has_permission
    from apps.tasks.business_time import business_calendar_day, business_day_real_range

    ahora = ahora or timezone.now()
    _, fin_de_hoy = business_day_real_range(business_calendar_day(ahora))

    notas = list(
        notas_vigentes()
        .filter(recipient_id=user.pk, read=False, archived=False)
        .select_related("sender")
        .order_by("-pinned", "-created_at", "-id")[:BLOQUE_MAX]
    )
    recordatorios = list(
        recordatorios_de(user)
        .filter(status=PersonalReminder.Status.PENDIENTE, archived=False, due_at__lte=fin_de_hoy)
        .order_by("due_at", "id")[:BLOQUE_MAX]
    )
    datos = {
        "pending_notes": [
            {
                "id": n.pk,
                "message": n.message,
                "priority": n.priority,
                "color": n.color,
                "pinned": n.pinned,
                "created_at": n.created_at,
                "sender_name": nombre_corto(n.sender),
            }
            for n in notas
        ],
        "today_reminders": [
            {
                "id": r.pk,
                "title": r.title,
                "due_at": r.due_at,
                "priority": r.priority,
                "overdue": r.due_at < ahora,
            }
            for r in recordatorios
        ],
        "upcoming_tasks": None,
        "recent_projects": None,
    }

    if access.puede_convertir_en_tarea(user):
        from apps.tasks.models import Task

        tareas = (
            Task.objects.filter(
                assigned_to_id=user.pk,
                archived_month__isnull=True,
                end_date__lte=ahora + timedelta(days=DIAS_DE_TAREAS_PROXIMAS),
            )
            .exclude(status=Task.Status.COMPLETADA)
            .order_by("end_date", "id")[:BLOQUE_MAX]
        )
        datos["upcoming_tasks"] = [
            {
                "id": t.pk,
                "title": t.title,
                "end_date": t.end_date,
                "priority": t.priority,
                "status": t.status,
            }
            for t in tareas
        ]

    if any(
        user_has_permission(user, c)
        for c in ("proyectos_gh.acceder", "proyectos_gh.supervisar", "proyectos_gh.administrar")
    ):
        from apps.projects.models import (
            Project,
            ProjectActivity,
            ProjectComment,
            ProjectHistory,
            ProjectParticipant,
        )

        desde = ahora - timedelta(days=DIAS_DE_PROYECTOS_RECIENTES)
        participa = ProjectParticipant.objects.filter(user_id=user.pk).values("project_id")
        # Subconsultas y no `JOIN` + `DISTINCT`: SQL Server no tiene que
        # comparar los textos largos de cada proyecto.
        con_actividad = (
            Q(pk__in=ProjectActivity.objects.filter(created_at__gte=desde).values("project_id"))
            | Q(pk__in=ProjectComment.objects.filter(created_at__gte=desde).values("project_id"))
            | Q(pk__in=ProjectHistory.objects.filter(created_at__gte=desde).values("project_id"))
        )
        proyectos = (
            Project.objects.filter(deleted_at__isnull=True)
            .filter(Q(responsible_id=user.pk) | Q(pk__in=participa))
            .filter(con_actividad)
            .order_by("-updated_at", "-id")[:BLOQUE_MAX]
        )
        datos["recent_projects"] = [
            {"id": p.pk, "name": p.name, "status": p.status, "updated_at": p.updated_at}
            for p in proyectos
        ]
    return datos


def buscar(user, *, q="", priority="", dia=None, sender="", recipient="", status="") -> dict:
    """El buscador único de Nexo (`GET /api/desk/search`): notas en que
    participa (por texto, incluido el de sus respuestas) y sus recordatorios.
    Los filtros de remitente y destinatario solo aplican a las notas. `dia` es
    una fecha (el día entero en la hora local; Nexo lo tomaba en UTC)."""
    notas = notas_de(user)
    # Palabra por palabra y sin tildes (ver `apps.core.busqueda`): la nota
    # casa si su texto o el de alguna de sus respuestas tiene todas las
    # palabras.
    en_la_nota = condicion_de_busqueda(q, ("message",))
    if en_la_nota is not None:
        con_respuesta = filtro_de_busqueda(DeskNoteReply.objects.all(), q, ("message",)).values(
            "note_id"
        )
        notas = notas.filter(en_la_nota | Q(pk__in=con_respuesta))
    if priority in DeskNote.Priority.values:
        notas = notas.filter(priority=priority)
    rango = None
    if dia is not None:
        inicio = timezone.make_aware(datetime.combine(dia, datetime.min.time()))
        rango = (inicio, inicio + timedelta(days=1) - timedelta(microseconds=1))
        notas = notas.filter(created_at__range=rango)
    for campo, texto in (("sender", sender), ("recipient", recipient)):
        if texto:
            notas = filtro_de_busqueda(
                notas,
                texto,
                (f"{campo}__first_name", f"{campo}__last_name", f"{campo}__username"),
            )
    if status == "PENDIENTE":
        notas = notas.filter(read=False, archived=False)
    elif status == "LEIDA":
        notas = notas.filter(read=True, archived=False)
    elif status == "ARCHIVADA":
        notas = notas.filter(archived=True)
    notas = notas.select_related("sender", "recipient").order_by("-created_at", "-id")[
        :RESULTADOS_MAX
    ]

    recordatorios = recordatorios_de(user)
    recordatorios = filtro_de_busqueda(recordatorios, q, ("title", "description"))
    if priority in PersonalReminder.Priority.values:
        recordatorios = recordatorios.filter(priority=priority)
    if rango is not None:
        recordatorios = recordatorios.filter(due_at__range=rango)
    if status in PersonalReminder.Status.values:
        recordatorios = recordatorios.filter(status=status)
    recordatorios = recordatorios.order_by("-due_at", "-id")[:RESULTADOS_MAX]
    return {"notes": list(notas), "reminders": list(recordatorios)}
