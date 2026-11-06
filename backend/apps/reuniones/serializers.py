"""Contratos de entrada y salida de Reuniones.

Las salidas siguen las de Nexo (`MeetingSerializer`) con estos cambios:

- `join_url`/`join_password` en vez de `zoom_join_url`/`zoom_password`, y sin
  `zoom_meeting_id` (ver `models`).
- Las personas (anfitrión e invitados) llevan su nombre legible y su rol de
  Gestión Humana; sin el correo.
- `status_label`, `ends_at` (la hora de término) y `timing` (próxima, en su
  horario o pasada, calculado al leer), más lo que la persona puede hacer con
  la reunión (`is_host`, `can_edit`).

Las entradas validan tipos, longitudes, rangos y opciones antes del servicio;
los enlaces (`https://`) y los invitados los valida el servicio.
"""

from datetime import timedelta

from rest_framework import serializers

from . import access
from .models import Meeting
from .services import (
    CLAVE_MAX,
    DESCRIPCION_MAX,
    DURACION_MAX,
    INVITADOS_MAX,
    RESUMEN_MAX,
    TITULO_MAX,
    URL_MAX,
    describir_personas,
    momento,
)

_DURACION_ERRORES = {
    "min_value": "La duración tiene que ser de al menos 1 minuto.",
    "max_value": f"La duración no puede pasar de {DURACION_MAX} minutos.",
    "invalid": "La duración tiene que ser un número entero de minutos.",
}


def _texto_obligatorio(valor: str, campo: str) -> str:
    limpio = (valor or "").strip()
    if not limpio:
        raise serializers.ValidationError(f"{campo} no puede estar vacío.")
    return limpio


class _Comun(serializers.Serializer):
    def validate_title(self, valor: str) -> str:
        return _texto_obligatorio(valor, "El título")


class MeetingCreateSerializer(_Comun):
    """`POST /reuniones/meetings/`."""

    title = serializers.CharField(max_length=TITULO_MAX)
    description = serializers.CharField(
        max_length=DESCRIPCION_MAX, required=False, allow_blank=True, allow_null=True
    )
    meeting_date = serializers.DateTimeField()
    duration = serializers.IntegerField(
        min_value=1, max_value=DURACION_MAX, error_messages=_DURACION_ERRORES
    )
    join_url = serializers.CharField(
        max_length=URL_MAX, required=False, allow_blank=True, allow_null=True, trim_whitespace=True
    )
    join_password = serializers.CharField(
        max_length=CLAVE_MAX, required=False, allow_blank=True, allow_null=True
    )
    invitee_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
        max_length=INVITADOS_MAX,
    )


class MeetingUpdateSerializer(_Comun):
    """`PATCH /reuniones/meetings/<id>/`: todos opcionales; solo cambia lo que
    se manda. `invitee_ids` es la lista completa de invitados."""

    title = serializers.CharField(max_length=TITULO_MAX, required=False)
    description = serializers.CharField(
        max_length=DESCRIPCION_MAX, required=False, allow_blank=True, allow_null=True
    )
    meeting_date = serializers.DateTimeField(required=False)
    duration = serializers.IntegerField(
        min_value=1, max_value=DURACION_MAX, required=False, error_messages=_DURACION_ERRORES
    )
    join_url = serializers.CharField(
        max_length=URL_MAX, required=False, allow_blank=True, allow_null=True
    )
    join_password = serializers.CharField(
        max_length=CLAVE_MAX, required=False, allow_blank=True, allow_null=True
    )
    status = serializers.ChoiceField(
        choices=Meeting.Status.choices,
        required=False,
        error_messages={
            "invalid_choice": "Estado inválido: use PROGRAMADA, EN_CURSO o FINALIZADA."
        },
    )
    otter_invited = serializers.BooleanField(required=False)
    otter_summary = serializers.CharField(
        max_length=RESUMEN_MAX, required=False, allow_blank=True, allow_null=True
    )
    otter_transcript_url = serializers.CharField(
        max_length=URL_MAX, required=False, allow_blank=True, allow_null=True
    )
    invitee_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, max_length=INVITADOS_MAX
    )


class MarcaDeAsistenciaSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    attended = serializers.BooleanField()


class AsistenciaSerializer(serializers.Serializer):
    """`POST /reuniones/meetings/<id>/attendance/`."""

    attendance = MarcaDeAsistenciaSerializer(many=True, allow_empty=False)

    def validate_attendance(self, marcas):
        ids = [m["user_id"] for m in marcas]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Cada persona puede ir una sola vez.")
        return marcas


# ── Salidas ───────────────────────────────────────────────────────────────────


def _fecha(valor):
    return serializers.DateTimeField().to_representation(valor) if valor else None


def _reunion(meeting: Meeting, viewer, personas: dict, invitados: list, ahora) -> dict:
    return {
        "id": meeting.pk,
        "title": meeting.title,
        "description": meeting.description,
        "host": personas.get(meeting.host_id),
        "meeting_date": _fecha(meeting.meeting_date),
        "duration": meeting.duration,
        "ends_at": _fecha(meeting.meeting_date + timedelta(minutes=meeting.duration or 0)),
        "timing": momento(meeting, ahora),
        "join_url": meeting.join_url,
        "join_password": meeting.join_password,
        "status": meeting.status,
        "status_label": Meeting.Status(meeting.status).label,
        "otter_invited": meeting.otter_invited,
        "otter_summary": meeting.otter_summary,
        "otter_transcript_url": meeting.otter_transcript_url,
        "created_at": _fecha(meeting.created_at),
        "updated_at": _fecha(meeting.updated_at),
        "invitees": [
            {"id": i.pk, "user": personas.get(i.user_id), "attended": i.attended} for i in invitados
        ],
        "is_host": meeting.host_id == viewer.pk,
        "can_edit": access.puede_editar(viewer, meeting),
    }


def lista(meetings, viewer) -> list[dict]:
    """Las reuniones con sus invitados, en dos consultas (y no una por
    reunión). Los invitados van por el nombre, como en Nexo."""
    from django.utils import timezone

    meetings = list(meetings.select_related("host").prefetch_related("invitees__user"))
    personas = describir_personas(
        [m.host for m in meetings] + [i.user for m in meetings for i in m.invitees.all()]
    )
    ahora = timezone.now()

    def orden(invitado):
        persona = personas.get(invitado.user_id) or {}
        return ((persona.get("full_name") or "").lower(), invitado.user_id)

    return [
        _reunion(m, viewer, personas, sorted(m.invitees.all(), key=orden), ahora) for m in meetings
    ]


def detalle(meeting_id, viewer) -> dict:
    """La reunión `meeting_id`, ya comprobada visible."""
    return lista(Meeting.objects.filter(pk=meeting_id), viewer)[0]


def personas(usuarios) -> list[dict]:
    """La lista de invitables, con su rol (para el selector)."""
    usuarios = list(usuarios)
    descritas = describir_personas(usuarios)
    return [descritas[u.pk] for u in usuarios]
