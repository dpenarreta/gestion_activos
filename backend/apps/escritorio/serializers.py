"""Contratos de entrada y salida del Escritorio.

Las salidas siguen las de Nexo (`DeskNoteSerializer`, `PersonalReminderSerializer`)
con estos cambios:

- **El adjunto** ya no es `has_attachment` + nombre + tipo (y el base64 por otra
  ruta): es `attachment`, con nombre, tipo, tamaño, `viewer` («pdf», «imagen» o
  `null` si se descarga) y `url`, la ruta protegida de la API (relativa a
  `/api/v1`) que lo muestra dentro del sistema.
- **Las personas** llevan su nombre legible y su rol de Gestión Humana.
- Las opciones llevan su etiqueta en español (`priority_label`, etc.).

Las entradas validan tipos, longitudes y opciones antes del servicio.
"""

from django.db.models import Count, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce
from rest_framework import serializers

from apps.tasks.models import Task

from .models import (
    MENSAJE_MAX,
    TITULO_MAX,
    DeskAuditAction,
    DeskNote,
    DeskNoteReply,
    PersonalReminder,
)
from .services import (
    ACCIONES_DE_NOTA,
    ACCIONES_DE_RECORDATORIO,
    DESCRIPCION_MAX,
    RESPUESTAS_MAX,
    adjunto,
    describir_personas,
)


def _texto_obligatorio(valor: str, campo: str) -> str:
    limpio = (valor or "").strip()
    if not limpio:
        raise serializers.ValidationError(f"{campo} no puede estar vacío.")
    return limpio


# ── Entradas: notas ───────────────────────────────────────────────────────────


class NotaCreateSerializer(serializers.Serializer):
    """`POST /escritorio/notes/`, multipart (con el adjunto) o JSON (sin él)."""

    recipient = serializers.IntegerField(min_value=1)
    message = serializers.CharField(max_length=MENSAJE_MAX)
    priority = serializers.ChoiceField(
        choices=DeskNote.Priority.choices, required=False, default=DeskNote.Priority.INFORMACION
    )
    color = serializers.ChoiceField(
        choices=DeskNote.Color.choices, required=False, default=DeskNote.Color.AMARILLO
    )
    attachment = serializers.FileField(required=False, allow_null=True, allow_empty_file=True)

    def validate_message(self, valor: str) -> str:
        return _texto_obligatorio(valor, "El mensaje")


class AccionDeNotaSerializer(serializers.Serializer):
    """`PATCH /escritorio/notes/<id>/`."""

    action = serializers.ChoiceField(
        choices=ACCIONES_DE_NOTA,
        error_messages={
            "invalid_choice": "Acción inválida: use read, pin, unpin, archive o unarchive."
        },
    )


class RespuestaSerializer(serializers.Serializer):
    """`POST /escritorio/notes/<id>/replies/`."""

    message = serializers.CharField(max_length=MENSAJE_MAX)

    def validate_message(self, valor: str) -> str:
        return _texto_obligatorio(valor, "La respuesta")


class NotaARecordatorioSerializer(serializers.Serializer):
    """`POST /escritorio/notes/<id>/convert-to-reminder/`. Sin título, el del
    mensaje; sin prioridad, la traducida de la nota (lo resuelve el servicio)."""

    title = serializers.CharField(
        max_length=TITULO_MAX, required=False, allow_blank=True, default=""
    )
    due_at = serializers.DateTimeField()
    priority = serializers.ChoiceField(
        choices=PersonalReminder.Priority.choices, required=False, allow_null=True, default=None
    )


# ── Entradas: recordatorios ───────────────────────────────────────────────────


class RecordatorioCreateSerializer(serializers.Serializer):
    """`POST /escritorio/reminders/`."""

    title = serializers.CharField(max_length=TITULO_MAX)
    description = serializers.CharField(
        max_length=DESCRIPCION_MAX, required=False, allow_blank=True, allow_null=True, default=""
    )
    due_at = serializers.DateTimeField()
    priority = serializers.ChoiceField(
        choices=PersonalReminder.Priority.choices,
        required=False,
        default=PersonalReminder.Priority.MEDIA,
    )
    repeat = serializers.ChoiceField(
        choices=PersonalReminder.Repeat.choices,
        required=False,
        default=PersonalReminder.Repeat.UNA_VEZ,
    )

    def validate_title(self, valor: str) -> str:
        return _texto_obligatorio(valor, "El título")


class RecordatorioUpdateSerializer(serializers.Serializer):
    """`PATCH /escritorio/reminders/<id>/` sin `action`: edición directa."""

    title = serializers.CharField(max_length=TITULO_MAX, required=False)
    description = serializers.CharField(
        max_length=DESCRIPCION_MAX, required=False, allow_blank=True, allow_null=True
    )
    due_at = serializers.DateTimeField(required=False)
    priority = serializers.ChoiceField(choices=PersonalReminder.Priority.choices, required=False)
    repeat = serializers.ChoiceField(choices=PersonalReminder.Repeat.choices, required=False)

    def validate_title(self, valor: str) -> str:
        return _texto_obligatorio(valor, "El título")


class AccionDeRecordatorioSerializer(serializers.Serializer):
    """`PATCH /escritorio/reminders/<id>/` con `action`. `due_at` es
    obligatorio al posponer y opcional al reabrir."""

    action = serializers.ChoiceField(
        choices=ACCIONES_DE_RECORDATORIO,
        error_messages={
            "invalid_choice": (
                "Acción inválida: use complete, postpone, reopen, archive o unarchive."
            )
        },
    )
    due_at = serializers.DateTimeField(required=False, allow_null=True, default=None)

    def validate(self, datos):
        if datos["action"] == "postpone" and datos.get("due_at") is None:
            raise serializers.ValidationError({"due_at": ["Indique hasta cuándo se pospone."]})
        return datos


class RecordatorioATareaSerializer(serializers.Serializer):
    """`POST /escritorio/reminders/<id>/convert-to-task/`: lo que pide Tareas
    salvo el responsable (uno mismo) y la prioridad (se traduce)."""

    title = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    type = serializers.ChoiceField(
        choices=Task.Type.choices, required=False, default=Task.Type.SEGUIMIENTO
    )
    frequency = serializers.ChoiceField(
        choices=Task.Frequency.choices, required=False, default=Task.Frequency.PUNTUAL
    )
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField()
    estimated_hours = serializers.FloatField(
        min_value=0.01,
        max_value=10000,
        error_messages={"min_value": "Las horas estimadas tienen que ser más que cero."},
    )


# ── Salidas ───────────────────────────────────────────────────────────────────


def _fecha(valor):
    return serializers.DateTimeField().to_representation(valor) if valor else None


def con_respuestas(notas):
    """Las notas con su número de respuestas calculado en la misma consulta
    (subconsulta: agrupar por la nota obligaría a agrupar por su mensaje)."""
    respuestas = (
        DeskNoteReply.objects.todas()
        .filter(note=OuterRef("pk"))
        .values("note")
        .annotate(total=Count("pk"))
        .values("total")[:1]
    )
    return notas.select_related("sender", "recipient").annotate(
        reply_count=Coalesce(Subquery(respuestas), Value(0))
    )


def _nota(nota: DeskNote, viewer, personas: dict) -> dict:
    total = getattr(nota, "reply_count", None)
    if total is None:
        total = nota.replies.count()
    return {
        "id": nota.pk,
        "message": nota.message,
        "priority": nota.priority,
        "priority_label": DeskNote.Priority(nota.priority).label,
        "color": nota.color,
        "read": nota.read,
        "read_at": _fecha(nota.read_at),
        "pinned": nota.pinned,
        "archived": nota.archived,
        "archived_at": _fecha(nota.archived_at),
        "created_at": _fecha(nota.created_at),
        "sender": personas.get(nota.sender_id),
        "recipient": personas.get(nota.recipient_id),
        "is_mine": nota.sender_id == viewer.pk,
        "reply_count": total,
        "can_reply": total < RESPUESTAS_MAX,
        "attachment": adjunto(nota, f"/escritorio/notes/{nota.pk}/attachment/"),
        "converted_to_reminder_id": nota.converted_to_reminder_id,
        "converted_at": _fecha(nota.converted_at),
    }


def notas(lista_de_notas, viewer) -> list[dict]:
    lista_de_notas = list(lista_de_notas)
    personas = describir_personas(
        [n.sender for n in lista_de_notas] + [n.recipient for n in lista_de_notas]
    )
    return [_nota(n, viewer, personas) for n in lista_de_notas]


def nota(nota_: DeskNote, viewer) -> dict:
    return notas(con_respuestas(DeskNote.objects.filter(pk=nota_.pk)), viewer)[0]


def respuestas(lista) -> list[dict]:
    lista = list(lista)
    personas = describir_personas(r.author for r in lista)
    return [
        {
            "id": r.pk,
            "message": r.message,
            "author": personas.get(r.author_id),
            "created_at": _fecha(r.created_at),
        }
        for r in lista
    ]


def recordatorio(r: PersonalReminder) -> dict:
    return {
        "id": r.pk,
        "title": r.title,
        "description": r.description,
        "due_at": _fecha(r.due_at),
        "priority": r.priority,
        "priority_label": PersonalReminder.Priority(r.priority).label,
        "status": r.status,
        "status_label": PersonalReminder.Status(r.status).label,
        "repeat": r.repeat,
        "repeat_label": PersonalReminder.Repeat(r.repeat).label,
        "completed_at": _fecha(r.completed_at),
        "archived": r.archived,
        "archived_at": _fecha(r.archived_at),
        "converted_to_task_id": r.converted_to_task_id,
        "converted_to_task_at": _fecha(r.converted_to_task_at),
        "attachment": adjunto(r, f"/escritorio/reminders/{r.pk}/attachment/"),
        "created_at": _fecha(r.created_at),
    }


def bitacora(eventos) -> list[dict]:
    eventos = list(eventos)
    personas = describir_personas(e.user for e in eventos)
    return [
        {
            "id": e.pk,
            "action": e.action,
            "action_label": (
                DeskAuditAction(e.action).label if e.action in DeskAuditAction.values else e.action
            ),
            "user": personas.get(e.user_id),
            "metadata": e.metadata,
            "created_at": _fecha(e.created_at),
        }
        for e in eventos
    ]


def destinatarios(personas) -> list[dict]:
    personas = list(personas)
    descritas = describir_personas(personas)
    return [descritas[p.pk] for p in personas]


def resultados_de_busqueda(resultado: dict, viewer) -> dict:
    lista = resultado["notes"]
    personas = describir_personas([n.sender for n in lista] + [n.recipient for n in lista])
    return {
        "notes": [
            {
                "id": n.pk,
                "message": n.message,
                "priority": n.priority,
                "color": n.color,
                "read": n.read,
                "archived": n.archived,
                "created_at": _fecha(n.created_at),
                "sender": personas.get(n.sender_id),
                "recipient": personas.get(n.recipient_id),
                "is_mine": n.sender_id == viewer.pk,
            }
            for n in lista
        ],
        "reminders": [
            {
                "id": r.pk,
                "title": r.title,
                "description": r.description,
                "due_at": _fecha(r.due_at),
                "priority": r.priority,
                "status": r.status,
            }
            for r in resultado["reminders"]
        ],
    }


def bandeja_de_hoy(datos: dict) -> dict:
    """Las fechas de `services.hoy` en ISO-8601."""
    resultado = {}
    for bloque, filas in datos.items():
        if filas is None:
            resultado[bloque] = None
            continue
        resultado[bloque] = [
            {c: _fecha(v) if hasattr(v, "isoformat") else v for c, v in fila.items()}
            for fila in filas
        ]
    return resultado
