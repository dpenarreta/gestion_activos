"""Mejora continua de Gestión Humana, portada de las «Ideas» de Nexo
(`apps.ideas`, 06/11/2026).

Tres modelos, los tres de Nexo con sus mismos nombres y campos, para portar
sus reglas y migrar sus datos tal cual:

- `ImprovementIdea`: la idea, con su impacto, su etapa, su avance y un adjunto.
- `IdeaVote`: un voto tipo «me gusta», uno por persona e idea. El conteo nunca
  se guarda en la idea: se cuenta al leer (como en Nexo).
- `IdeaStatusHistory`: cada cambio de etapa, con quién y su comentario. Nunca
  se edita ni se borra.

Lo que cambia al llegar a la intranet:

- Multiempresa: la idea hereda de `ModeloDeEmpresa`; el voto y el historial
  cuelgan de ella (`gestor_de_lo_que_cuelga("idea__empresa")`).
- El adjunto ya no es base64 dentro de la base (`attachment_data`): es un
  archivo (`FileField`) en el almacenamiento de la intranet, validado como los
  demás adjuntos (`apps.adjuntos.validators`), con su nombre original, su tipo
  (el de la extensión validada, nunca el del navegador) y su tamaño. Se ve
  dentro del sistema (`services.visor_de`).
- En Nexo el adjunto se BORRABA al salir de PROPUESTA (era base64 en la base y
  ocupaba espacio). Aquí se conserva: es un archivo en disco y es parte de la
  propuesta que se evaluó.
- La insignia «innovador» de Nexo (`User.badges`) no es un campo: la intranet
  no tiene insignias de usuario. Se deriva del historial (`services.innovadores`).
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa


def ruta_adjunto(instance, filename: str) -> str:
    """El nombre en disco no es el original (que puede traer cualquier cosa):
    un uuid con la extensión ya validada, en la carpeta de la empresa."""
    return (
        f"mejora_continua/{instance.empresa_id or 'sin_empresa'}/"
        f"{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"
    )


class ImprovementIdea(ModeloDeEmpresa):
    class Impact(models.TextChoices):
        ALTO = "ALTO", "Alto"
        MEDIO = "MEDIO", "Medio"
        BAJO = "BAJO", "Bajo"

    class Status(models.TextChoices):
        PROPUESTA = "PROPUESTA", "Propuesta"
        EN_REVISION = "EN_REVISION", "En revisión"
        APROBADA = "APROBADA", "Aprobada"
        EN_DESARROLLO = "EN_DESARROLLO", "En desarrollo"
        EN_PRUEBAS = "EN_PRUEBAS", "En pruebas"
        IMPLEMENTADA = "IMPLEMENTADA", "Implementada"
        RECHAZADA = "RECHAZADA", "Rechazada"

    title = models.CharField(max_length=255)
    description = models.TextField()
    impact = models.CharField(max_length=10, choices=Impact.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PROPUESTA)
    #: 0 a 100. En Nexo se muestra en EN_DESARROLLO, pero se guarda siempre.
    progress = models.PositiveSmallIntegerField(default=0)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="ideas_de_mejora", on_delete=models.PROTECT
    )
    #: El adjunto, opcional. Vacío si no tiene.
    attachment = models.FileField(upload_to=ruta_adjunto, max_length=255, blank=True)
    #: El nombre original, para mostrarlo.
    attachment_name = models.CharField(max_length=255, blank=True, default="")
    #: El tipo que corresponde a la extensión validada, no el del navegador.
    attachment_mime = models.CharField(max_length=100, blank=True, default="")
    attachment_size = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["empresa", "status"]),
            models.Index(fields=["author"]),
        ]

    def __str__(self) -> str:
        return self.title


class IdeaVote(BaseModel):
    """Voto binario, uno por `(idea, user)`."""

    idea = models.ForeignKey(ImprovementIdea, related_name="votes", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="votos_de_ideas", on_delete=models.PROTECT
    )

    objects = gestor_de_lo_que_cuelga("idea__empresa")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["idea", "user"], name="mejora_continua_un_voto")
        ]

    def __str__(self) -> str:
        return f"{self.idea_id}:{self.user_id}"


class IdeaStatusHistory(BaseModel):
    """Un cambio de etapa. Append-only."""

    idea = models.ForeignKey(ImprovementIdea, related_name="history", on_delete=models.CASCADE)
    from_status = models.CharField(max_length=20, choices=ImprovementIdea.Status.choices)
    to_status = models.CharField(max_length=20, choices=ImprovementIdea.Status.choices)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )
    comment = models.TextField(null=True, blank=True)

    objects = gestor_de_lo_que_cuelga("idea__empresa")

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["idea", "created_at"]), models.Index(fields=["to_status"])]

    def __str__(self) -> str:
        return f"{self.idea_id}: {self.from_status} -> {self.to_status}"
