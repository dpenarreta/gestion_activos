"""Contratos de entrada y salida de Mejora continua.

Las salidas siguen las de Nexo (`ideaListSelect`, `ideaDetailSelect`) con estos
cambios:

- **El adjunto** ya no trae `attachment_data` (base64): trae `attachment`, con
  su nombre, tipo, tamaño, `viewer` («pdf», «imagen» o `null` si se descarga) y
  `url`, la ruta protegida de la API (relativa a `/api/v1`) que lo muestra
  dentro del sistema con la misma visibilidad que la idea.
- **Las personas** (autor y quien cambió la etapa) llevan su rol de Gestión
  Humana, su nombre legible e `innovador` (la insignia de Nexo, derivada). Sin
  el correo: el tablero no lo necesita.
- Las etapas y el impacto llevan su etiqueta en español (`status_label`,
  `impact_label`), y el detalle, `allowed_actions`: lo que el servidor acepta
  desde la etapa actual a quien puede mover la idea.

Las entradas validan tipos, longitudes y opciones antes de llegar al servicio.
"""

from django.db.models import Count, Exists, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce
from rest_framework import serializers

from . import access
from .models import IdeaStatusHistory, IdeaVote, ImprovementIdea
from .services import (
    ACCIONES,
    COMENTARIO_MAX,
    DESCRIPCION_MAX,
    TITULO_MAX,
    acciones_posibles,
    describir_personas,
    etiqueta_de_etapa,
    visor_de,
)

# ── Entradas ──────────────────────────────────────────────────────────────────


def _texto_obligatorio(valor: str, campo: str) -> str:
    limpio = (valor or "").strip()
    if not limpio:
        raise serializers.ValidationError(f"{campo} no puede estar vacío.")
    return limpio


class IdeaCreateSerializer(serializers.Serializer):
    """`POST /ideas/`, multipart (con el adjunto) o JSON (sin adjunto)."""

    title = serializers.CharField(max_length=TITULO_MAX, trim_whitespace=True)
    description = serializers.CharField(max_length=DESCRIPCION_MAX, trim_whitespace=True)
    impact = serializers.ChoiceField(
        choices=ImprovementIdea.Impact.choices,
        error_messages={"invalid_choice": "Impacto inválido: use ALTO, MEDIO o BAJO."},
    )
    attachment = serializers.FileField(required=False, allow_null=True, allow_empty_file=True)

    def validate_title(self, valor: str) -> str:
        return _texto_obligatorio(valor, "El título")

    def validate_description(self, valor: str) -> str:
        return _texto_obligatorio(valor, "La descripción")


class ProgresoSerializer(serializers.Serializer):
    """`PATCH /ideas/<id>/`: entero de 0 a 100 (como en Nexo)."""

    progress = serializers.IntegerField(
        min_value=0,
        max_value=100,
        error_messages={
            "min_value": "El avance debe estar entre 0 y 100.",
            "max_value": "El avance debe estar entre 0 y 100.",
            "invalid": "El avance debe ser un número entero entre 0 y 100.",
        },
    )


class CambioDeEtapaSerializer(serializers.Serializer):
    """`POST /ideas/<id>/status/`. `comment` es opcional salvo al rechazar
    (lo exige el servicio). `expected_status` es la etapa que la pantalla está
    viendo: si ya cambió, 409 en lugar de moverla otra vez."""

    action = serializers.ChoiceField(
        choices=ACCIONES,
        error_messages={
            "invalid_choice": "Acción inválida: use ADVANCE, RETREAT, REJECT o REOPEN."
        },
    )
    comment = serializers.CharField(
        max_length=COMENTARIO_MAX, required=False, allow_blank=True, allow_null=True, default=None
    )
    expected_status = serializers.ChoiceField(
        choices=ImprovementIdea.Status.choices, required=False, allow_null=True, default=None
    )

    def validate_comment(self, valor: str | None) -> str | None:
        limpio = (valor or "").strip()
        return limpio or None


# ── Salidas ───────────────────────────────────────────────────────────────────


def con_conteos(ideas, viewer):
    """Las ideas con lo que el tablero necesita calculado en la misma consulta:
    votos, si `viewer` votó y el último motivo de rechazo."""
    ultimo_rechazo = (
        IdeaStatusHistory.objects.todas()
        .filter(idea=OuterRef("pk"), to_status=ImprovementIdea.Status.RECHAZADA)
        .order_by("-created_at", "-id")
        .values("comment")[:1]
    )
    # Los votos, como subconsulta y no con `Count` sobre la idea: agrupar por
    # la idea obligaría a SQL Server a agrupar por su descripción (texto largo).
    votos = (
        IdeaVote.objects.todas()
        .filter(idea=OuterRef("pk"))
        .values("idea")
        .annotate(total=Count("pk"))
        .values("total")[:1]
    )
    return (
        ideas.select_related("author")
        .annotate(
            vote_count=Coalesce(Subquery(votos), Value(0)),
            voted_by_me=Exists(
                IdeaVote.objects.todas().filter(idea=OuterRef("pk"), user_id=viewer.pk)
            ),
            latest_rejection_comment=Subquery(ultimo_rechazo),
        )
        .order_by("-created_at", "-id")
    )


def adjunto(idea: ImprovementIdea) -> dict | None:
    if not idea.attachment:
        return None
    return {
        "name": idea.attachment_name,
        "mime": idea.attachment_mime,
        "size": idea.attachment_size,
        "viewer": visor_de(idea.attachment_mime),
        "url": f"/mejora-continua/ideas/{idea.pk}/attachment/",
    }


def _idea(idea: ImprovementIdea, viewer, personas: dict) -> dict:
    return {
        "id": idea.pk,
        "title": idea.title,
        "description": idea.description,
        "impact": idea.impact,
        "impact_label": ImprovementIdea.Impact(idea.impact).label,
        "status": idea.status,
        "status_label": etiqueta_de_etapa(idea.status),
        "progress": idea.progress,
        "author": personas.get(idea.author_id),
        "is_mine": idea.author_id == viewer.pk,
        "vote_count": getattr(idea, "vote_count", 0),
        "voted_by_me": bool(getattr(idea, "voted_by_me", False)),
        "latest_rejection_comment": getattr(idea, "latest_rejection_comment", None),
        "attachment": adjunto(idea),
        "created_at": serializers.DateTimeField().to_representation(idea.created_at),
        "updated_at": serializers.DateTimeField().to_representation(idea.updated_at),
    }


def lista(ideas, viewer) -> list[dict]:
    """El tablero: las ideas ya anotadas por `con_conteos`."""
    ideas = list(ideas)
    personas = describir_personas(i.author for i in ideas)
    return [_idea(i, viewer, personas) for i in ideas]


def historial(entradas, personas: dict | None = None) -> list[dict]:
    entradas = list(entradas)
    if personas is None:
        personas = describir_personas(e.changed_by for e in entradas)
    return [
        {
            "id": e.pk,
            "from_status": e.from_status,
            "from_status_label": etiqueta_de_etapa(e.from_status),
            "to_status": e.to_status,
            "to_status_label": etiqueta_de_etapa(e.to_status),
            "comment": e.comment,
            "created_at": serializers.DateTimeField().to_representation(e.created_at),
            "changer": personas.get(e.changed_by_id),
        }
        for e in entradas
    ]


def detalle(idea_id, viewer) -> dict:
    """La idea con su historial completo (en orden) y lo que `viewer` puede
    hacer con ella. `idea_id` ya se comprobó visible."""
    idea = con_conteos(ImprovementIdea.objects.filter(pk=idea_id), viewer).get()
    entradas = list(idea.history.select_related("changed_by").order_by("created_at", "id"))
    personas = describir_personas([idea.author, *(e.changed_by for e in entradas)])
    datos = _idea(idea, viewer, personas)
    puede_gestionar = access.puede_gestionar(viewer)
    datos["history"] = historial(entradas, personas)
    datos["can_manage"] = puede_gestionar
    datos["can_vote"] = access.puede_votar(viewer)
    datos["allowed_actions"] = acciones_posibles(idea.status) if puede_gestionar else []
    return datos
