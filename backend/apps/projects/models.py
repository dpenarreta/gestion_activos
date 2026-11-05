"""Modelos de Proyectos (Gestión Humana), portados de Nexo (fase 2b, 05/11/2026).

Se conservan los nombres de Nexo (modelos y campos en inglés) para portar sus
pruebas y migrar los datos tal cual. Lo que cambia al llegar a la intranet:

- Multiempresa: `Project` y `RecoveryItem` heredan de `ModeloDeEmpresa`; lo
  que cuelga de un proyecto usa `gestor_de_lo_que_cuelga("project__empresa")`.
- Los documentos ya no guardan el archivo en base64 dentro de la base
  (`file_data`): van como archivo (`FileField`) en el almacenamiento de la
  intranet, validados como los adjuntos de Soporte (`apps.adjuntos.validators`).
  `services.load_base64_file` convierte el base64 de Nexo en archivo para la
  migración de datos.
- La papelera (`apps.recovery` de Nexo) vive aquí, solo para Proyectos: en la
  intranet no hay otro módulo que la use (el Escritorio Digital de Nexo no se
  porta). Su bitácora (`RecoveryAuditLog`) pasa a la auditoría común
  (`record_audit_event`).

Proyectos no usa IA en Nexo: no hay nada que dejar fuera por eso.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa
from apps.tasks.models import Task


def ruta_documento(instance, filename: str) -> str:
    """El nombre en disco no es el original (que puede traer cualquier cosa):
    un uuid con la extensión ya validada, en la carpeta del proyecto."""
    return (
        f"proyectos_gh/{instance.project_id}/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"
    )


class Project(ModeloDeEmpresa):
    """Iniciativa transversal, independiente de `Task`: no cuenta para la
    carga laboral ni se cierra con el mes."""

    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        PLANIFICACION = "PLANIFICACION", "Planificación"
        EN_EJECUCION = "EN_EJECUCION", "En ejecución"
        EN_REVISION = "EN_REVISION", "En revisión"
        SUSPENDIDO = "SUSPENDIDO", "Suspendido"
        COMPLETADO = "COMPLETADO", "Completado"
        CANCELADO = "CANCELADO", "Cancelado"

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDIENTE)
    #: Mismas prioridades que Tareas (como en Nexo).
    priority = models.CharField(max_length=10, choices=Task.Priority.choices)
    area = models.CharField(max_length=255, blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    observations = models.TextField(blank=True, default="")
    start_date = models.DateTimeField()
    target_date = models.DateTimeField()
    #: Tiempo objetivo global, en horas.
    target_time_hours = models.FloatField()
    #: Suma de las actividades registradas (`services.recalc_project_real_hours`).
    real_hours = models.FloatField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="responsible_projects", on_delete=models.PROTECT
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="created_projects", on_delete=models.PROTECT
    )
    #: En la papelera: invisible para el listado y el detalle. Lo pone y lo
    #: quita la papelera (`recovery.py`), nunca una edición.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["empresa", "status"]),
            models.Index(fields=["empresa", "deleted_at"]),
        ]

    def __str__(self) -> str:
        return self.name


class ProjectParticipant(BaseModel):
    project = models.ForeignKey(Project, related_name="participants", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="project_participations", on_delete=models.PROTECT
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )
    added_at = models.DateTimeField(auto_now_add=True)

    objects = gestor_de_lo_que_cuelga("project__empresa")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "user"], name="unique_project_participant")
        ]


class ProjectHistoryEvent(models.TextChoices):
    """Los 14 eventos de Nexo. `ACTUALIZADO`, `COMENTARIO_AGREGADO` y
    `ACTIVIDAD_REGISTRADA` quedan sin uso a propósito (como en Nexo: editar
    campos no estratégicos, comentar o registrar horas no van al historial)."""

    CREADO = "CREADO", "Creado"
    ACTUALIZADO = "ACTUALIZADO", "Actualizado"
    PARTICIPANTE_AGREGADO = "PARTICIPANTE_AGREGADO", "Participante agregado"
    PARTICIPANTE_ELIMINADO = "PARTICIPANTE_ELIMINADO", "Participante eliminado"
    RESPONSABLE_CAMBIADO = "RESPONSABLE_CAMBIADO", "Responsable cambiado"
    ESTADO_CAMBIADO = "ESTADO_CAMBIADO", "Estado cambiado"
    FASE_AGREGADA = "FASE_AGREGADA", "Fase agregada"
    FASE_ACTUALIZADA = "FASE_ACTUALIZADA", "Fase actualizada"
    FASE_ELIMINADA = "FASE_ELIMINADA", "Fase eliminada"
    COMENTARIO_AGREGADO = "COMENTARIO_AGREGADO", "Comentario agregado"
    ACTIVIDAD_REGISTRADA = "ACTIVIDAD_REGISTRADA", "Actividad registrada"
    DOCUMENTO_AGREGADO = "DOCUMENTO_AGREGADO", "Documento agregado"
    ELIMINADO = "ELIMINADO", "Eliminado"
    RESTAURADO = "RESTAURADO", "Restaurado"


class ProjectHistory(models.Model):
    """Bitácora del proyecto, append-only: nunca se edita ni se borra (salvo
    con el proyecto, al eliminarlo definitivamente)."""

    project = models.ForeignKey(Project, related_name="history", on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    event = models.CharField(max_length=30, choices=ProjectHistoryEvent.choices)
    description = models.CharField(max_length=500)
    previous_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = gestor_de_lo_que_cuelga("project__empresa")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["project", "created_at"])]

    def __str__(self) -> str:
        return f"{self.project_id}:{self.event}"


class ProjectComment(BaseModel):
    project = models.ForeignKey(Project, related_name="comments", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    text = models.TextField()

    objects = gestor_de_lo_que_cuelga("project__empresa")

    class Meta:
        ordering = ["created_at", "id"]


class ProjectPhase(BaseModel):
    project = models.ForeignKey(Project, related_name="phases", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    #: Mismos estados que una tarea (como en Nexo).
    status = models.CharField(
        max_length=20, choices=Task.Status.choices, default=Task.Status.PENDIENTE
    )
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    start_date = models.DateTimeField(null=True, blank=True)
    target_date = models.DateTimeField(null=True, blank=True)
    progress = models.IntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    target_time_hours = models.FloatField(null=True, blank=True)
    order = models.IntegerField(default=0)

    objects = gestor_de_lo_que_cuelga("project__empresa")

    class Meta:
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["project", "order"])]

    def __str__(self) -> str:
        return self.name


class ProjectActivity(BaseModel):
    """Horas registradas en un proyecto (en minutos, como `TaskActivity`). A
    diferencia de Tareas, no se valida el solapamiento de horarios."""

    project = models.ForeignKey(Project, related_name="activities", on_delete=models.CASCADE)
    phase = models.ForeignKey(
        ProjectPhase, related_name="activities", null=True, blank=True, on_delete=models.SET_NULL
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    description = models.TextField()
    comments = models.TextField(null=True, blank=True)
    start_time = models.CharField(max_length=5, null=True, blank=True)
    end_time = models.CharField(max_length=5, null=True, blank=True)
    duration = models.PositiveIntegerField()
    is_retroactive = models.BooleanField(default=False)
    activity_date = models.DateTimeField(null=True, blank=True)

    objects = gestor_de_lo_que_cuelga("project__empresa")

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["project", "created_at"]),
            models.Index(fields=["author", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.project_id}:{self.author_id}:{self.duration}min"


class ProjectDocument(BaseModel):
    """Un documento del proyecto, como archivo. `previous_version_id` es una
    referencia suelta (sin FK, como en Nexo): permite versiones sin encadenar
    borrados."""

    class Category(models.TextChoices):
        PDF = "PDF", "PDF"
        EXCEL = "EXCEL", "Excel"
        WORD = "WORD", "Word"
        IMAGEN = "IMAGEN", "Imagen"
        CORREO = "CORREO", "Correo"
        ACTA = "ACTA", "Acta"
        OTRO = "OTRO", "Otro"

    project = models.ForeignKey(Project, related_name="documents", on_delete=models.CASCADE)
    activity = models.ForeignKey(
        ProjectActivity, related_name="documents", null=True, blank=True, on_delete=models.SET_NULL
    )
    category = models.CharField(max_length=10, choices=Category.choices, default=Category.OTRO)
    #: El nombre original, para mostrarlo y para la descarga.
    file_name = models.CharField(max_length=255)
    #: El tipo que corresponde a la extensión validada, no el que dijo el
    #: navegador (`services.DOCUMENT_FORMATS`).
    mime_type = models.CharField(max_length=255, blank=True, default="")
    file = models.FileField(upload_to=ruta_documento, max_length=255)
    file_size = models.PositiveIntegerField(default=0)
    version = models.IntegerField(default=1)
    previous_version_id = models.BigIntegerField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )

    objects = gestor_de_lo_que_cuelga("project__empresa")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["project"])]

    def __str__(self) -> str:
        return self.file_name


class RecoveryItem(ModeloDeEmpresa):
    """La papelera (de Nexo, `apps.recovery.RecoveryItem`), solo para
    Proyectos. `entity_type`/`entity_id` son una referencia suelta, como en
    Nexo: sobreviven a la purga del proyecto. Un mismo proyecto puede tener
    varias filas en el tiempo (papelera → restaurado → papelera); la vigente
    es la más reciente en estado ACTIVE."""

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "En la papelera"
        RESTORED = "RESTORED", "Restaurado"
        PURGED = "PURGED", "Eliminado definitivamente"

    class Origin(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        AUTOMATIC = "AUTOMATIC", "Automático"

    entity_type = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=64)
    entity_label = models.CharField(max_length=255, null=True, blank=True)
    module_label = models.CharField(max_length=100)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.ACTIVE)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )
    #: El mismo instante con el que se calcula `expires_at`.
    deleted_at = models.DateTimeField()
    retention_hours = models.PositiveIntegerField()
    expires_at = models.DateTimeField()
    restored_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    restored_at = models.DateTimeField(null=True, blank=True)
    purged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    purged_at = models.DateTimeField(null=True, blank=True)
    purge_origin = models.CharField(max_length=15, choices=Origin.choices, null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["empresa", "entity_type", "entity_id"]),
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.entity_type}:{self.entity_id} ({self.status})"
