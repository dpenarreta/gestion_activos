"""Modelos de Tareas (Gestión Humana), portados de Nexo (fase 2a, 04/11/2026).

Se conservan los nombres de Nexo (modelos y campos en inglés) para portar sus
pruebas y migrar los datos tal cual. Lo que cambia al llegar a la intranet:

- Multiempresa: los modelos raíz heredan de `ModeloDeEmpresa` (llevan la
  empresa y su gestor la filtra) y los que cuelgan de otro usan
  `gestor_de_lo_que_cuelga`. Lo que era único en Nexo pasa a serlo dentro de
  cada empresa (la clave de un motivo, el mes cerrado).
- Las bitácoras con el id de la tarea o de la actividad «suelto» (sin FK, para
  sobrevivir a su borrado) llevan su propia empresa: no tienen de quién
  heredarla.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa


class Task(ModeloDeEmpresa):
    class Status(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        EN_PROGRESO = "EN_PROGRESO", "En progreso"
        COMPLETADA = "COMPLETADA", "Completada"

    class Priority(models.TextChoices):
        ALTA = "ALTA", "Alta"
        MEDIA = "MEDIA", "Media"
        BAJA = "BAJA", "Baja"

    class Frequency(models.TextChoices):
        MENSUAL = "MENSUAL", "Mensual"
        SEMANAL = "SEMANAL", "Semanal"
        DIARIA = "DIARIA", "Diaria"
        QUINCENAL = "QUINCENAL", "Quincenal"
        PUNTUAL = "PUNTUAL", "Puntual"

    class Type(models.TextChoices):
        FIJA = "FIJA", "Fija"
        SEGUIMIENTO = "SEGUIMIENTO", "Seguimiento"

    class EndDateApprovalStatus(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        APROBADA = "APROBADA", "Aprobada"
        MODIFICADA = "MODIFICADA", "Modificada"
        RECHAZADA = "RECHAZADA", "Rechazada"

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDIENTE)
    priority = models.CharField(max_length=10, choices=Priority.choices)
    frequency = models.CharField(max_length=10, choices=Frequency.choices)
    type = models.CharField(max_length=15, choices=Type.choices, default=Type.FIJA)
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    estimated_hours = models.FloatField()
    real_hours = models.FloatField(default=0)
    target_time_validated = models.FloatField(null=True, blank=True)
    target_time_validated_at = models.DateTimeField(null=True, blank=True)
    target_time_validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    end_date_approval_status = models.CharField(
        max_length=15,
        choices=EndDateApprovalStatus.choices,
        default=EndDateApprovalStatus.PENDIENTE,
    )
    end_date_approved_at = models.DateTimeField(null=True, blank=True)
    end_date_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.SET_NULL
    )
    progress = models.PositiveSmallIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    color = models.CharField(max_length=20, blank=True, default="")
    archived_month = models.CharField(max_length=7, null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    #: El cierre de mes YA generó la instancia del mes siguiente a partir de
    #: esta tarea. Una recurrente sin completar sigue viva (no se archiva): sin
    #: esta marca volvería a entrar como candidata en cada cierre posterior.
    successor_created_at = models.DateTimeField(null=True, blank=True)
    corrected = models.BooleanField(default=False)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="assigned_tasks", on_delete=models.PROTECT
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="created_tasks", on_delete=models.PROTECT
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["empresa", "assigned_to", "archived_month"]),
            models.Index(fields=["empresa", "archived_month", "end_date"]),
        ]

    def __str__(self) -> str:
        return self.title


class Comment(BaseModel):
    task = models.ForeignKey(Task, related_name="comments", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    text = models.TextField()

    objects = gestor_de_lo_que_cuelga("task__empresa")

    class Meta:
        ordering = ["created_at"]


class ActivityReason(ModeloDeEmpresa):
    """Catálogo de motivos de registro de horas. `assigned_roles` es una lista
    JSON de nombres de rol (`auth.Group`); `TaskActivity.reason` referencia
    `key` por convención, nunca por FK (igual que en Nexo)."""

    key = models.CharField(max_length=100)
    label = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    assigned_roles = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "key"], name="tasks_activityreason_key_uniq")
        ]

    def __str__(self) -> str:
        return self.key


class TaskActivity(BaseModel):
    """Registro de horas sobre una tarea."""

    task = models.ForeignKey(Task, related_name="activities", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    reason = models.CharField(max_length=100)
    start_time = models.CharField(max_length=5, null=True, blank=True)
    end_time = models.CharField(max_length=5, null=True, blank=True)
    duration = models.PositiveIntegerField()
    description = models.TextField(blank=True, default="")
    is_retroactive = models.BooleanField(default=False)
    activity_date = models.DateTimeField(null=True, blank=True)
    admin_comment = models.TextField(null=True, blank=True)
    modified_by_admin = models.BooleanField(default=False)
    modified_at = models.DateTimeField(null=True, blank=True)

    objects = gestor_de_lo_que_cuelga("task__empresa")

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["author", "created_at"])]


class ActivityComment(BaseModel):
    activity = models.ForeignKey(TaskActivity, related_name="comments", on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    text = models.TextField()

    objects = gestor_de_lo_que_cuelga("activity__task__empresa")

    class Meta:
        ordering = ["created_at"]


class ActivityAuditLog(ModeloDeEmpresa):
    """Bitácora append-only de las ediciones de horas por el Administrador.
    `activity_id` va suelto, sin FK: sobrevive al borrado de la actividad."""

    activity_id = models.PositiveBigIntegerField(db_index=True)
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    old_duration = models.PositiveIntegerField()
    new_duration = models.PositiveIntegerField()
    comment = models.TextField()
    #: El mismo instante que `TaskActivity.modified_at` (lo pasa el servicio).
    modified_at = models.DateTimeField()

    class Meta:
        ordering = ["-modified_at"]


class TargetTimeAuditLog(ModeloDeEmpresa):
    """Bitácora append-only de las validaciones de Tiempo Objetivo. `task_id`
    va suelto, sin FK; `user_role` es el rol del actor en ese momento."""

    class Reason(models.TextChoices):
        PROCEDIMIENTO_ESTANDAR = "PROCEDIMIENTO_ESTANDAR", "Procedimiento estándar"
        COMPLEJIDAD_DETECTADA = "COMPLEJIDAD_DETECTADA", "Complejidad detectada"
        CAMBIO_ALCANCE = "CAMBIO_ALCANCE", "Cambio de alcance"
        REVISION_LIDER = "REVISION_LIDER", "Revisión del líder"
        OTRO = "OTRO", "Otro"

    task_id = models.PositiveBigIntegerField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    user_role = models.CharField(max_length=50, blank=True, default="")
    previous_value = models.FloatField(null=True, blank=True)
    new_value = models.FloatField()
    reason = models.CharField(max_length=30, choices=Reason.choices)
    reason_detail = models.TextField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class EndDateAuditLog(ModeloDeEmpresa):
    """Bitácora append-only de la Fecha Fin: la propuesta del colaborador y
    las tres decisiones del líder."""

    class Action(models.TextChoices):
        PROPUESTA = "PROPUESTA", "Propuesta"
        APROBADA = "APROBADA", "Aprobada"
        MODIFICADA = "MODIFICADA", "Modificada"
        RECHAZADA = "RECHAZADA", "Rechazada"

    task_id = models.PositiveBigIntegerField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    user_role = models.CharField(max_length=50, blank=True, default="")
    action = models.CharField(max_length=15, choices=Action.choices)
    previous_value = models.DateTimeField(null=True, blank=True)
    new_value = models.DateTimeField(null=True, blank=True)
    observaciones = models.TextField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class MonthClosure(ModeloDeEmpresa):
    """Cierre de mes (Motor de Cierre Inteligente). `closed_at` es cuándo se
    ejecutó; `cutoff_date`, hasta cuándo cuenta la data. Los días y horas
    considerados quedan congelados al cerrar."""

    class ClosureType(models.TextChoices):
        NORMAL = "NORMAL", "Normal"
        EARLY = "EARLY", "Anticipado"
        MANUAL = "MANUAL", "Manual"

    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="closed_task_months", on_delete=models.PROTECT
    )
    closed_at = models.DateTimeField(auto_now_add=True)
    cutoff_date = models.DateTimeField()
    closure_type = models.CharField(
        max_length=10, choices=ClosureType.choices, default=ClosureType.NORMAL
    )
    calendar_days_total = models.PositiveSmallIntegerField()
    calendar_days_considered = models.PositiveSmallIntegerField()
    working_days_considered = models.PositiveSmallIntegerField()
    working_hours_considered = models.FloatField()
    total_tasks = models.PositiveIntegerField()
    completed_tasks = models.PositiveIntegerField()
    summary = models.JSONField()
    corrections = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-year", "-month"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "month", "year"], name="tasks_monthclosure_month_year_uniq"
            )
        ]

    def __str__(self) -> str:
        return f"{self.year}-{self.month:02d}"


class TaskCommentView(BaseModel):
    """Última vez que una persona vio los comentarios de una tarea (para
    `has_unread_comments`): `updated_at` hace de «visto en»."""

    task = models.ForeignKey(Task, related_name="comment_views", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.CASCADE)

    objects = gestor_de_lo_que_cuelga("task__empresa")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["task", "user"], name="tasks_taskcommentview_uniq")
        ]
