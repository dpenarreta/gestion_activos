"""Escritorio de Gestión Humana, portado del «Escritorio Digital» de Nexo
(`apps.desk`, 06/11/2026).

Cuatro modelos, los de Nexo con sus mismos nombres y campos:

- `DeskNote`: una nota rápida de una persona a otra (prioridad, color, leída,
  fijada, archivada, adjunto), que se puede convertir en recordatorio.
- `DeskNoteReply`: las respuestas de una nota, entre sus dos participantes.
- `PersonalReminder`: la agenda personal (prioridad, estado, repetición), que
  avisa en la campana al vencer y se puede convertir en tarea.
- `DeskAuditLog`: la bitácora de notas y recordatorios (una sola tabla).

Convive con el chat de la intranet: el chat es la conversación; la nota es un
pendiente que queda en el escritorio de quien la recibe hasta que la archiva.

Lo que cambia al llegar a la intranet:

- **Multiempresa**: la nota, el recordatorio y la bitácora heredan de
  `ModeloDeEmpresa`; las respuestas cuelgan de su nota.
- **Adjuntos como archivos** (`FileField`) en el almacenamiento de la
  intranet, validados como los de Mejora continua, y no base64 dentro de la
  fila (`attachment_data`). El recordatorio que sale de una nota se lleva una
  COPIA del archivo, como en Nexo: así sobrevive aunque la nota se archive y se
  purgue.
- **La papelera**: en Nexo, la nota que borraba su remitente iba al Centro de
  Recuperación (48 horas) y nadie más la veía. Aquí es `deleted_at` en la
  propia nota; el ciclo del escritorio la borra del todo pasado ese plazo
  (`services.purgar`).
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa

MENSAJE_MAX = 500
TITULO_MAX = 150


def ruta_adjunto(instance, filename: str) -> str:
    """El nombre en disco no es el original (que puede traer cualquier cosa):
    un uuid con la extensión ya validada, en la carpeta de la empresa."""
    return (
        f"escritorio/{instance.empresa_id or 'sin_empresa'}/"
        f"{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"
    )


class ConAdjunto(models.Model):
    """El adjunto opcional de una nota o de un recordatorio."""

    attachment = models.FileField(upload_to=ruta_adjunto, max_length=255, blank=True)
    #: El nombre original, para mostrarlo.
    attachment_name = models.CharField(max_length=255, blank=True, default="")
    #: El tipo que corresponde a la extensión validada, no el del navegador.
    attachment_mime = models.CharField(max_length=100, blank=True, default="")
    attachment_size = models.PositiveIntegerField(default=0)

    class Meta:
        abstract = True


class DeskNote(ModeloDeEmpresa, ConAdjunto):
    class Priority(models.TextChoices):
        INFORMACION = "INFORMACION", "Información"
        RECORDATORIO = "RECORDATORIO", "Recordatorio"
        IMPORTANTE = "IMPORTANTE", "Importante"
        URGENTE = "URGENTE", "Urgente"

    class Color(models.TextChoices):
        AMARILLO = "AMARILLO", "Amarillo"
        ROSADO = "ROSADO", "Rosado"
        CELESTE = "CELESTE", "Celeste"
        VERDE = "VERDE", "Verde"
        NARANJA = "NARANJA", "Naranja"
        LILA = "LILA", "Lila"

    sender = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="notas_de_escritorio", on_delete=models.PROTECT
    )
    message = models.CharField(max_length=MENSAJE_MAX)
    priority = models.CharField(
        max_length=20, choices=Priority.choices, default=Priority.INFORMACION
    )
    color = models.CharField(max_length=20, choices=Color.choices, default=Color.AMARILLO)
    read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    pinned = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    #: El recordatorio que salió de esta nota. La nota no cambia al convertirse.
    converted_to_reminder = models.ForeignKey(
        "PersonalReminder", related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    converted_at = models.DateTimeField(null=True, blank=True)
    #: En la papelera de su remitente: nadie la ve (ver el docstring del módulo).
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-pinned", "-created_at", "-id"]
        indexes = [
            models.Index(fields=["empresa", "recipient", "archived", "created_at"]),
            models.Index(fields=["empresa", "sender", "created_at"]),
            models.Index(fields=["deleted_at"]),
            models.Index(fields=["archived", "archived_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.sender_id} -> {self.recipient_id}: {self.message[:30]}"


class DeskNoteReply(BaseModel):
    note = models.ForeignKey(DeskNote, related_name="replies", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    message = models.CharField(max_length=MENSAJE_MAX)

    objects = gestor_de_lo_que_cuelga("note__empresa")

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["note", "created_at"])]

    def __str__(self) -> str:
        return f"{self.note_id}: {self.message[:30]}"


class PersonalReminder(ModeloDeEmpresa, ConAdjunto):
    """La agenda personal: un solo dueño, sin remitente ni destinatario."""

    class Priority(models.TextChoices):
        BAJA = "BAJA", "Baja"
        MEDIA = "MEDIA", "Media"
        ALTA = "ALTA", "Alta"
        URGENTE = "URGENTE", "Urgente"

    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        COMPLETADO = "COMPLETADO", "Completado"

    class Repeat(models.TextChoices):
        UNA_VEZ = "UNA_VEZ", "Una vez"
        DIARIO = "DIARIO", "Diario"
        SEMANAL = "SEMANAL", "Semanal"
        MENSUAL = "MENSUAL", "Mensual"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="recordatorios_personales", on_delete=models.PROTECT
    )
    title = models.CharField(max_length=TITULO_MAX)
    description = models.TextField(null=True, blank=True)
    due_at = models.DateTimeField()
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIA)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDIENTE)
    repeat = models.CharField(max_length=20, choices=Repeat.choices, default=Repeat.UNA_VEZ)
    completed_at = models.DateTimeField(null=True, blank=True)
    archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    #: Ya se avisó de este vencimiento: no se vuelve a avisar hasta que cambie.
    notified = models.BooleanField(default=False)
    #: La tarea que salió de este recordatorio. El recordatorio no cambia.
    converted_to_task = models.ForeignKey(
        "tasks.Task", related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    converted_to_task_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["due_at", "id"]
        indexes = [
            models.Index(fields=["empresa", "user", "status", "due_at"]),
            models.Index(fields=["empresa", "user", "archived"]),
            models.Index(fields=["status", "notified", "due_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.title[:30]}"


class DeskAuditAction(models.TextChoices):
    CREATED = "CREATED", "Creado"
    EDITED = "EDITED", "Editado"
    READ = "READ", "Leído"
    PINNED = "PINNED", "Fijado"
    UNPINNED = "UNPINNED", "Desfijado"
    ARCHIVED = "ARCHIVED", "Archivado"
    UNARCHIVED = "UNARCHIVED", "Desarchivado"
    DELETED = "DELETED", "Eliminado"
    CONVERTED_TO_TASK = "CONVERTED_TO_TASK", "Convertido en tarea"
    CONVERTED_TO_REMINDER = "CONVERTED_TO_REMINDER", "Convertido en recordatorio"
    PRIORITY_CHANGED = "PRIORITY_CHANGED", "Prioridad cambiada"
    POSTPONED = "POSTPONED", "Pospuesto"
    COMPLETED = "COMPLETED", "Completado"
    REOPENED = "REOPENED", "Reabierto"
    REPLIED = "REPLIED", "Respondido"


class DeskAuditLog(ModeloDeEmpresa):
    """La bitácora del escritorio, append-only: nunca se edita ni se borra.
    `entity_id` es un número suelto, sin clave foránea, para que sobreviva al
    borrado de la nota o del recordatorio (como en Nexo)."""

    class EntityType(models.TextChoices):
        NOTE = "NOTE", "Nota"
        REMINDER = "REMINDER", "Recordatorio"

    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    entity_id = models.PositiveBigIntegerField()
    #: Quien actuó. Vacío en lo que hace el sistema solo (la purga del archivo).
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    action = models.CharField(max_length=30, choices=DeskAuditAction.choices)
    metadata = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["empresa", "entity_type", "entity_id"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.entity_type}#{self.entity_id}: {self.action}"
