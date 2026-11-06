"""Reuniones de Gestión Humana, portadas de Nexo (`apps.meetings`, 06/11/2026).

Dos modelos, los dos de Nexo con sus mismos nombres:

- `Meeting`: la reunión, con su anfitrión, su fecha y duración, su enlace y el
  resumen que el anfitrión escribe a mano al terminar (los campos de Otter).
- `MeetingInvitee`: cada persona invitada, una vez por reunión, con su
  asistencia.

Lo que cambia al llegar a la intranet:

- **Sin Zoom.** Nexo creaba la reunión en Zoom con una cuenta de servicio (y,
  si Zoom fallaba, inventaba un enlace que no llevaba a ningún lado). Aquí
  quien organiza pega a mano el enlace de su reunión —Zoom, Teams, Meet u
  otro— y, si la tiene, la clave (decisión del usuario). Por eso los campos se
  llaman `join_url`/`join_password` y no `zoom_*`, y `zoom_meeting_id` no
  existe: era el id interno de Zoom, que la intranet no usa.
- **Otter** nunca tuvo integración en Nexo: `otter_invited`, `otter_summary` y
  `otter_transcript_url` eran campos que el anfitrión llenaba a mano. Se
  conservan igual.
- **Multiempresa**: la reunión hereda de `ModeloDeEmpresa`; los invitados
  cuelgan de ella (`gestor_de_lo_que_cuelga("meeting__empresa")`).
- **Baja lógica**: en Nexo, eliminar una reunión la borraba. Aquí se marca
  `deleted_at` (deja de verse) y queda en la auditoría: es lo que exige el
  criterio de seguridad del proyecto para lo que se elimina desde la API.
- **La asistencia** (`attended`) existía en Nexo pero nada la leía ni la
  escribía. Aquí el anfitrión la marca desde el detalle.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa

#: Largo máximo de un enlace (el de la reunión y el de la transcripción). Un
#: enlace de Teams con su contexto pasa holgadamente de 255.
URL_MAX = 1000


class Meeting(ModeloDeEmpresa):
    class Status(models.TextChoices):
        PROGRAMADA = "PROGRAMADA", "Programada"
        EN_CURSO = "EN_CURSO", "En curso"
        FINALIZADA = "FINALIZADA", "Finalizada"

    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="reuniones_organizadas", on_delete=models.PROTECT
    )
    meeting_date = models.DateTimeField()
    #: En minutos.
    duration = models.PositiveIntegerField()
    #: El enlace para unirse, pegado a mano por quien organiza (siempre https).
    join_url = models.CharField(max_length=URL_MAX, null=True, blank=True)
    #: La clave de la reunión, si la tiene. La ven solo el anfitrión y los
    #: invitados, y nunca va a la auditoría.
    join_password = models.CharField(max_length=50, null=True, blank=True)
    #: Lo cambia el anfitrión a mano, como en Nexo.
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PROGRAMADA)
    otter_invited = models.BooleanField(default=False)
    otter_summary = models.TextField(null=True, blank=True)
    otter_transcript_url = models.CharField(max_length=URL_MAX, null=True, blank=True)
    #: Baja lógica: una reunión eliminada no se ve en ningún lado.
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )

    class Meta:
        ordering = ["meeting_date", "id"]
        indexes = [
            models.Index(fields=["empresa", "deleted_at", "meeting_date"]),
            models.Index(fields=["host"]),
        ]

    def __str__(self) -> str:
        return self.title


class MeetingInvitee(BaseModel):
    """Una persona invitada, una vez por reunión."""

    meeting = models.ForeignKey(Meeting, related_name="invitees", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="invitaciones_a_reuniones", on_delete=models.PROTECT
    )
    attended = models.BooleanField(default=False)

    objects = gestor_de_lo_que_cuelga("meeting__empresa")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["meeting", "user"], name="reuniones_un_invitado")
        ]
        indexes = [models.Index(fields=["user"])]

    def __str__(self) -> str:
        return f"{self.meeting_id}:{self.user_id}"
