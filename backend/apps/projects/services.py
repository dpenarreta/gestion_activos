"""Lógica de negocio de Proyectos (Gestión Humana), portada de Nexo.

Se conserva la lógica de Nexo (`apps/projects/services.py` y las reglas que
allá vivían en las vistas) con estas traducciones, documentadas donde ocurren:

1. **Quién ve y quién gestiona** sale del organigrama y del catálogo de
   permisos (`permissions.py`), no del nivel del rol.
2. **Las personas** que se eligen (responsable, participantes, responsable de
   una fase) tienen que estar activas en la empresa y tener acceso al módulo:
   un proyecto que su responsable no puede abrir no sirve de nada.
3. **Los documentos** son archivos (`FileField`), validados como los adjuntos
   de Soporte; el base64 de Nexo se sigue aceptando y se convierte en archivo
   (`load_base64_file`), para el cliente portado y para la migración.
4. **Avisos** en la campana (`proyectos.<categoría>`) después de confirmar, y
   **auditoría** común (`record_audit_event`, módulo `proyectos_gh`). Nexo no
   avisaba nada en Proyectos: los avisos son nuevos.

Las vistas solo resuelven parámetros y delegan aquí; toda escritura y toda
regla de autorización por registro viven en este módulo.
"""

import base64
import binascii
import logging
import zipfile
from datetime import datetime
from datetime import timezone as dt_timezone
from pathlib import PurePath

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import serializers as drf_serializers

from apps.adjuntos.validators import validar_archivo
from apps.core.audit import record_audit_event
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.tasks import jerarquia
from apps.tasks.business_time import (
    business_calendar_day,
    business_day_real_range,
    parse_date_only,
    retroactive_valid_dates,
    time_to_minutes,
)
from apps.tasks.configuracion import get_effective_retroactive_window_days
from apps.tasks.rounding import round_half_up

from . import permissions as access
from . import recovery
from .models import (
    Project,
    ProjectActivity,
    ProjectComment,
    ProjectDocument,
    ProjectHistory,
    ProjectHistoryEvent,
    ProjectParticipant,
    ProjectPhase,
    RecoveryItem,
)

logger = logging.getLogger(__name__)
User = get_user_model()

AUDIT_MODULE = "proyectos_gh"

#: Descripción mínima de una actividad (Nexo, Sprint 2.1 §7).
MIN_DESCRIPTION_LENGTH = 15

#: Tope del base64 que se acepta en el cuerpo JSON (el de Nexo: ~4.5 MB de
#: binario). Por encima se responde 413; el archivo multipart tiene además el
#: tope general de adjuntos (`apps.adjuntos.models.TAMANO_MAXIMO_BYTES`).
MAX_BASE64_LENGTH = 6_000_000

#: Firmas del contenido (los primeros bytes). Los Office actuales (OOXML) son
#: contenedores ZIP; los antiguos (.doc, .xls, .ppt), documentos compuestos OLE.
FIRMA_PDF = [b"%PDF-"]
FIRMA_ZIP = [b"PK\x03\x04"]
FIRMA_OLE = [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"]

MIME_PDF = "application/pdf"
MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

#: Los documentos de un proyecto (decisión del usuario del 05/11/2026): solo
#: PDF, Word, Excel y PowerPoint; ya no imágenes. Extensión → (tipo con que se
#: guarda y se sirve, firmas aceptadas). Es una lista propia de Proyectos: lo
#: que aceptan los demás módulos (`apps.adjuntos.models.FIRMAS`) no cambia.
DOCUMENT_FORMATS: dict[str, tuple[str, list[bytes]]] = {
    ".pdf": (MIME_PDF, FIRMA_PDF),
    ".doc": ("application/msword", FIRMA_OLE),
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        FIRMA_ZIP,
    ),
    ".xls": ("application/vnd.ms-excel", FIRMA_OLE),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", FIRMA_ZIP),
    ".ppt": ("application/vnd.ms-powerpoint", FIRMA_OLE),
    ".pptx": (MIME_PPTX, FIRMA_ZIP),
}

#: Un OOXML no es cualquier ZIP: trae `[Content_Types].xml` y la carpeta de
#: su aplicación. Así un .zip (o un ejecutable comprimido) renombrado a .docx
#: no entra aunque su firma sea la de un ZIP.
OOXML_FOLDERS = {".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}

#: Cómo se ve cada documento dentro del sistema: el PDF en el visor de PDF y
#: la .pptx en el visor de presentaciones (el de Capacitación, que la dibuja
#: en el navegador). Word, Excel y el .ppt antiguo (binario, que el navegador
#: no puede leer) se descargan.
VIEWERS = {MIME_PDF: "pdf", MIME_PPTX: "presentacion"}

#: Adónde llevan los avisos de la campana (ruta del frontend).
PROJECT_LINK = "/admin/gestion-humana/proyectos"
SUMMARY_MAX = 300

ALERT_TITLES = {
    "participante": "Proyectos: lo agregaron a un proyecto",
    "responsable": "Proyectos: es responsable de un proyecto",
    "estado": "Proyectos: cambió el estado de un proyecto",
    "comentario": "Proyectos: nuevo comentario",
}


class ProyectosError(Exception):
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


def _forbidden(message: str) -> ProyectosError:
    return ProyectosError(message, code="permission_denied", status=403)


def _conflict(message: str) -> ProyectosError:
    return ProyectosError(message, code="conflict", status=409)


def _invalid(field: str, message: str) -> ProyectosError:
    return ProyectosError(message, details={field: [message]})


def user_display(user) -> str:
    if user is None:
        return ""
    return (user.get_full_name() or "").strip() or user.username


def _short_name(user) -> str:
    """El nombre corto de Nexo (`first_name or username`) para el historial."""
    return (user.first_name or "").strip() or user.username


def _active_company():
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        return None
    return empresa


def _audit(actor, action: str, *, target=None, target_type=None, target_id=None, **kw):
    record_audit_event(
        actor=actor,
        action=f"proyectos_gh.{action}",
        target=target,
        target_type=target_type,
        target_id=target_id,
        module=AUDIT_MODULE,
        previous_values=kw.get("previous"),
        new_values=kw.get("new"),
        context=kw.get("context"),
    )


def _notify(users, *, category: str, message: str, project: Project, actor=None) -> None:
    """Aviso en la campana de cada destinatario, después de confirmar: si la
    campana falla, la operación no se revierte. Solo lleva el nombre de quien
    actuó y el del proyecto; nunca el texto de un comentario."""
    destinatarios = [u for u in users if u is not None and (actor is None or u.pk != actor.pk)]
    if not destinatarios:
        return
    resumen = message if len(message) <= SUMMARY_MAX else message[: SUMMARY_MAX - 1] + "…"
    empresa = project.empresa
    enlace = f"{PROJECT_LINK}/{project.pk}"

    def enviar():
        from apps.notificaciones.services import notificar

        notificar(
            destinatarios,
            tipo=f"proyectos.{category}",
            titulo=ALERT_TITLES.get(category, "Proyectos"),
            resumen=resumen,
            enlace=enlace,
            empresa=empresa,
        )

    transaction.on_commit(enviar)


def _people_of(project: Project) -> list:
    """Responsable, creador y participantes (sin repetir)."""
    personas = {
        project.responsible_id: project.responsible,
        project.created_by_id: project.created_by,
    }
    for participant in project.participants.select_related("user"):
        personas.setdefault(participant.user_id, participant.user)
    return list(personas.values())


def log_project_history(
    *,
    project_id,
    actor,
    event: str,
    description: str,
    previous_value: dict | None = None,
    new_value: dict | None = None,
) -> None:
    """Un registro por evento relevante; nunca se edita ni se borra."""
    ProjectHistory.objects.create(
        project_id=project_id,
        actor=actor,
        event=event,
        description=description[:500],
        previous_value=previous_value,
        new_value=new_value,
    )


# ── Personas que se pueden elegir ────────────────────────────────────────────


def is_eligible_member(user) -> bool:
    """Activa, de la empresa activa y con acceso a Proyectos."""
    if user is None or not user.is_active:
        return False
    empresa = _active_company()
    if empresa is not None and not user.membresias.filter(empresa=empresa).exists():
        return False
    return access.can(user, access.ACCEDER)


def eligible_members():
    """Las cuentas activas de la empresa con acceso a Proyectos (para los
    selectores de responsable y participantes)."""
    empresa = _active_company()
    candidatos = User.objects.filter(is_active=True)
    if empresa is not None:
        candidatos = candidatos.filter(membresias__empresa=empresa)
    candidatos = candidatos.distinct().order_by("first_name", "last_name", "username")
    return [u for u in candidatos if access.can(u, access.ACCEDER)]


def _require_eligible(user, field: str) -> None:
    if not is_eligible_member(user):
        raise _invalid(
            field,
            f'"{user_display(user)}" no puede participar en proyectos: no está activo en la '
            "empresa o no tiene acceso al módulo.",
        )


# ── Visibilidad ─────────────────────────────────────────────────────────────


def visible_projects(actor):
    """Los proyectos (fuera de la papelera) que la persona puede ver."""
    qs = Project.objects.filter(deleted_at__isnull=True)
    if access.is_admin(actor):
        return qs
    personas = {actor.pk} | jerarquia.equipo_ids(actor)
    con_participante = ProjectParticipant.objects.filter(user_id__in=personas).values("project_id")
    return qs.filter(
        Q(responsible_id__in=personas) | Q(created_by_id__in=personas) | Q(pk__in=con_participante)
    )


def get_visible_project(actor, pk) -> Project:
    """El proyecto si existe, no está en la papelera y la persona lo ve; si
    no, 404 (no se revela que existe)."""
    project = (
        Project.objects.select_related("responsible", "created_by", "empresa")
        .filter(pk=pk, deleted_at__isnull=True)
        .first()
    )
    if project is None or not access.can_view_project(actor, project):
        raise ProyectosError("Proyecto no encontrado.", code="not_found", status=404)
    return project


def require_manager(actor, project: Project, message: str) -> None:
    if not access.is_project_manager(actor, project):
        raise _forbidden(message)


def require_participant(actor, project: Project, message: str) -> None:
    if not access.is_project_participant(actor, project):
        raise _forbidden(message)


# ── Proyecto ────────────────────────────────────────────────────────────────


class ProjectService:
    @staticmethod
    def create_project(*, actor, participant_ids: list, context=None, **fields) -> Project:
        """El responsable y el creador no se agregan solos como participantes
        (Nexo, Sprint 2.1): solo los elegidos."""
        if not access.can_create_project(actor):
            raise _forbidden("No tiene permiso para crear proyectos.")
        _require_eligible(fields["responsible"], "responsible")
        if fields["target_date"] < fields["start_date"]:
            raise _invalid("target_date", "La fecha objetivo no puede ser anterior a la de inicio.")

        participants = []
        unique_ids = list(dict.fromkeys(participant_ids or []))
        for user in User.objects.filter(pk__in=unique_ids):
            _require_eligible(user, "participant_ids")
            participants.append(user)
        if len(participants) != len(unique_ids):
            raise _invalid("participant_ids", "Alguno de los participantes no existe.")

        with transaction.atomic():
            project = Project.objects.create(created_by=actor, **fields)
            for user in participants:
                ProjectParticipant.objects.create(project=project, user=user, added_by=actor)
            log_project_history(
                project_id=project.id,
                actor=actor,
                event=ProjectHistoryEvent.CREADO,
                description=f'{_short_name(actor)} creó el proyecto "{project.name}"',
                new_value={
                    "name": project.name,
                    "status": project.status,
                    "responsible_id": project.responsible_id,
                },
            )
            _audit(
                actor,
                "creado",
                target=project,
                new={
                    "name": project.name,
                    "status": project.status,
                    "responsible_id": project.responsible_id,
                    "participant_ids": [u.pk for u in participants],
                },
                context=context,
            )
            _notify(
                [project.responsible],
                category="responsable",
                message=f'{user_display(actor)} lo designó responsable del proyecto "{project.name}".',
                project=project,
                actor=actor,
            )
            _notify(
                [u for u in participants if u.pk != project.responsible_id],
                category="participante",
                message=f'{user_display(actor)} lo agregó al proyecto "{project.name}".',
                project=project,
                actor=actor,
            )
        return project

    @staticmethod
    def update_project(*, actor, project: Project, fields: dict, context=None) -> Project:
        """Solo el cambio de estado y de responsable van al historial del
        proyecto (Nexo, Sprint 2.1); la auditoría registra todo cambio."""
        require_manager(actor, project, "No tiene permiso para editar este proyecto.")

        previous_status = project.status
        previous_responsible_id = project.responsible_id

        new_status = fields.get("status")
        status_changed = "status" in fields and new_status != previous_status
        if status_changed:
            fields["completed_at"] = (
                timezone.now() if new_status == Project.Status.COMPLETADO else None
            )

        new_responsible = fields.get("responsible")
        responsible_changed = (
            "responsible" in fields and new_responsible.id != previous_responsible_id
        )
        if responsible_changed:
            _require_eligible(new_responsible, "responsible")

        start = fields.get("start_date", project.start_date)
        target = fields.get("target_date", project.target_date)
        if target < start:
            raise _invalid("target_date", "La fecha objetivo no puede ser anterior a la de inicio.")
        if "name" in fields and not fields["name"]:
            raise _invalid("name", "El nombre del proyecto es obligatorio.")

        previous = {}
        for field in fields:
            if field == "completed_at":
                continue
            valor = getattr(project, f"{field}_id" if field == "responsible" else field)
            previous[field] = _audit_value(valor)

        with transaction.atomic():
            for field, value in fields.items():
                setattr(project, field, value)
            project.save()

            if responsible_changed:
                ProjectParticipant.objects.get_or_create(
                    project=project, user=new_responsible, defaults={"added_by": actor}
                )
            if status_changed:
                log_project_history(
                    project_id=project.id,
                    actor=actor,
                    event=ProjectHistoryEvent.ESTADO_CAMBIADO,
                    description=(
                        f'{_short_name(actor)} cambió el estado de "{project.name}" de '
                        f"{previous_status} a {new_status}"
                    ),
                    previous_value={"status": previous_status},
                    new_value={"status": new_status},
                )
            if responsible_changed:
                log_project_history(
                    project_id=project.id,
                    actor=actor,
                    event=ProjectHistoryEvent.RESPONSABLE_CAMBIADO,
                    description=(
                        f'{_short_name(actor)} cambió el responsable principal de "{project.name}"'
                    ),
                    previous_value={"responsible_id": previous_responsible_id},
                    new_value={"responsible_id": new_responsible.id},
                )
            nuevos = {
                f: _audit_value(new_responsible.id if f == "responsible" else fields[f])
                for f in previous
            }
            _audit(
                actor, "actualizado", target=project, previous=previous, new=nuevos, context=context
            )

            if responsible_changed:
                _notify(
                    [new_responsible],
                    category="responsable",
                    message=(
                        f'{user_display(actor)} lo designó responsable del proyecto "{project.name}".'
                    ),
                    project=project,
                    actor=actor,
                )
            if status_changed:
                _notify(
                    _people_of(project),
                    category="estado",
                    message=(
                        f'{user_display(actor)} cambió el estado de "{project.name}" a '
                        f"{Project.Status(new_status).label}."
                    ),
                    project=project,
                    actor=actor,
                )
        return project

    @staticmethod
    def soft_delete_project(*, actor, project: Project, context=None) -> None:
        """A la papelera: quien lo creó o quien administra el módulo."""
        if not access.can_delete_project(actor, project):
            raise _forbidden(
                "Solo quien creó el proyecto o quien administra Proyectos puede enviarlo "
                "a la papelera."
            )
        name = project.name
        try:
            with transaction.atomic():
                recovery.move_to_trash(
                    entity_type=recovery.PROJECT,
                    entity_id=str(project.id),
                    user=actor,
                    context=context,
                )
                log_project_history(
                    project_id=project.id,
                    actor=actor,
                    event=ProjectHistoryEvent.ELIMINADO,
                    description=f'{_short_name(actor)} movió el proyecto "{name}" a la papelera',
                )
        except recovery.RecoveryError as exc:
            raise _conflict(str(exc)) from exc

    @staticmethod
    def _trashed(actor, pk) -> Project:
        """Para restaurar o eliminar para siempre, con el orden de Nexo: 404
        (no existe) → 409 (no está en la papelera) → 403 (ni su creador ni
        quien administra).
        Uno que la persona no ve cuenta como inexistente."""
        project = Project.objects.filter(pk=pk).first()
        if project is None or not access.can_view_project(actor, project):
            raise ProyectosError("Proyecto no encontrado.", code="not_found", status=404)
        if project.deleted_at is None:
            raise _conflict("Este proyecto no está en la papelera.")
        return project

    @staticmethod
    def restore_project(*, actor, pk, context=None) -> Project:
        project = ProjectService._trashed(actor, pk)
        if not access.can_delete_project(actor, project):
            raise _forbidden(
                "Solo quien creó el proyecto o quien administra Proyectos puede restaurarlo."
            )
        try:
            with transaction.atomic():
                recovery.restore(
                    entity_type=recovery.PROJECT,
                    entity_id=str(project.id),
                    user=actor,
                    context=context,
                )
                log_project_history(
                    project_id=project.id,
                    actor=actor,
                    event=ProjectHistoryEvent.RESTAURADO,
                    description=(
                        f'{_short_name(actor)} restauró el proyecto "{project.name}" desde la papelera'
                    ),
                )
        except recovery.RecoveryError as exc:
            raise _conflict(str(exc)) from exc
        return project

    @staticmethod
    def delete_project_permanently(*, actor, pk, context=None) -> None:
        """Irreversible: borra el proyecto con todo lo que cuelga y los
        archivos de sus documentos. Queda la auditoría."""
        project = ProjectService._trashed(actor, pk)
        if not access.can_delete_project(actor, project):
            raise _forbidden(
                "Solo quien creó el proyecto o quien administra Proyectos puede eliminarlo "
                "definitivamente."
            )
        try:
            recovery.delete_permanently(
                entity_type=recovery.PROJECT,
                entity_id=str(project.id),
                user=actor,
                context=context,
            )
        except recovery.RecoveryError as exc:
            raise _conflict(str(exc)) from exc

    @staticmethod
    def trash(actor) -> list[dict]:
        """La papelera: purga lo vencido (perezosa, como en Nexo) y lista lo
        que queda. Quien administra ve toda la de la empresa; quien supervisa,
        la de su equipo además de la suya; los demás, solo lo que crearon.
        Restaura o elimina su creador o quien administra (`can_delete`)."""
        if not access.can_create_project(actor):
            raise _forbidden("No tiene permiso para ver la papelera de proyectos.")
        recovery.purge_expired_items()

        qs = Project.objects.filter(deleted_at__isnull=False).select_related(
            "responsible", "created_by"
        )
        es_admin = access.is_admin(actor)
        if not es_admin:
            creadores = {actor.pk}
            if access.can(actor, access.SUPERVISAR):
                creadores |= jerarquia.equipo_ids(actor)
            qs = qs.filter(created_by_id__in=creadores)

        items = {
            item.entity_id: item
            for item in RecoveryItem.objects.filter(
                entity_type=recovery.PROJECT, status=RecoveryItem.Status.ACTIVE
            ).order_by("deleted_at", "id")
        }
        payload = []
        ahora = timezone.now()
        for project in qs.order_by("-deleted_at", "-id"):
            item = items.get(str(project.id))
            remaining = (
                max(0, round_half_up((item.expires_at - ahora).total_seconds() * 1000))
                if item
                else 0
            )
            payload.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "status": project.status,
                    "responsible": {
                        "id": project.responsible.id,
                        "name": user_display(project.responsible),
                    },
                    "created_by": {
                        "id": project.created_by.id,
                        "name": user_display(project.created_by),
                    },
                    "deleted_at": project.deleted_at,
                    "expires_at": item.expires_at if item else None,
                    "ms_remaining": remaining,
                    "can_delete": es_admin or project.created_by_id == actor.id,
                }
            )
        return payload


def _audit_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


# ── Participantes ───────────────────────────────────────────────────────────


class ParticipantService:
    @staticmethod
    def add_participant(*, actor, project: Project, user, context=None) -> ProjectParticipant:
        require_manager(actor, project, "No tiene permiso para agregar participantes.")
        if ProjectParticipant.objects.filter(project=project, user=user).exists():
            raise _conflict("Este usuario ya es participante del proyecto")
        _require_eligible(user, "user")
        with transaction.atomic():
            participant = ProjectParticipant.objects.create(
                project=project, user=user, added_by=actor
            )
            log_project_history(
                project_id=project.id,
                actor=actor,
                event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO,
                description=(
                    f"{_short_name(actor)} agregó a {_short_name(user)} como participante de "
                    f'"{project.name}"'
                ),
                new_value={"user_id": user.id},
            )
            _audit(
                actor,
                "participante_agregado",
                target=project,
                new={"user_id": user.id},
                context=context,
            )
            _notify(
                [user],
                category="participante",
                message=f'{user_display(actor)} lo agregó al proyecto "{project.name}".',
                project=project,
                actor=actor,
            )
        return participant

    @staticmethod
    def remove_participant(*, actor, project: Project, participant_id, context=None) -> None:
        require_manager(actor, project, "No tiene permiso para quitar participantes.")
        participant = (
            ProjectParticipant.objects.select_related("user")
            .filter(pk=participant_id, project=project)
            .first()
        )
        if participant is None:
            raise ProyectosError("Participante no encontrado.", code="not_found", status=404)
        if participant.user_id == project.responsible_id:
            raise _conflict(
                "No puede quitar al responsable principal: cambie el responsable primero."
            )
        removed_user = participant.user
        with transaction.atomic():
            participant.delete()
            log_project_history(
                project_id=project.id,
                actor=actor,
                event=ProjectHistoryEvent.PARTICIPANTE_ELIMINADO,
                description=(
                    f'{_short_name(actor)} quitó a {_short_name(removed_user)} del proyecto "{project.name}"'
                ),
                previous_value={"user_id": removed_user.id},
            )
            _audit(
                actor,
                "participante_quitado",
                target=project,
                previous={"user_id": removed_user.id},
                context=context,
            )


# ── Comentarios ─────────────────────────────────────────────────────────────


class CommentService:
    """No van al historial del proyecto (tienen su propia pestaña)."""

    @staticmethod
    def create_comment(*, project: Project, author, text: str) -> ProjectComment:
        require_participant(author, project, "Solo los participantes pueden comentar.")
        with transaction.atomic():
            comment = ProjectComment.objects.create(
                project=project, author=author, text=text.strip()
            )
            _notify(
                _people_of(project),
                category="comentario",
                message=f'{user_display(author)} comentó en el proyecto "{project.name}".',
                project=project,
                actor=author,
            )
        return comment


# ── Fases ───────────────────────────────────────────────────────────────────


class PhaseService:
    @staticmethod
    def create_phase(*, actor, project: Project, context=None, **fields) -> ProjectPhase:
        require_manager(actor, project, "No tiene permiso para agregar fases.")
        if fields.get("responsible") is not None:
            _require_eligible(fields["responsible"], "responsible")
        _check_phase_dates(fields.get("start_date"), fields.get("target_date"))
        with transaction.atomic():
            order = ProjectPhase.objects.filter(project=project).count()
            phase = ProjectPhase.objects.create(project=project, order=order, **fields)
            log_project_history(
                project_id=project.id,
                actor=actor,
                event=ProjectHistoryEvent.FASE_AGREGADA,
                description=f'{_short_name(actor)} agregó la fase "{phase.name}" a "{project.name}"',
                new_value={"phase_id": phase.id, "name": phase.name},
            )
            _audit(
                actor,
                "fase_creada",
                target=phase,
                new={"project_id": project.id, "name": phase.name},
                context=context,
            )
        return phase

    @staticmethod
    def get_phase(project: Project, phase_id) -> ProjectPhase:
        phase = ProjectPhase.objects.filter(pk=phase_id, project=project).first()
        if phase is None:
            raise ProyectosError("Fase no encontrada.", code="not_found", status=404)
        return phase

    @staticmethod
    def update_phase(
        *, actor, project: Project, phase: ProjectPhase, fields: dict, context=None
    ) -> ProjectPhase:
        """Solo el cambio de estado va al historial (Nexo, Sprint 2.1)."""
        require_manager(actor, project, "No tiene permiso para modificar fases.")
        if fields.get("responsible") is not None:
            _require_eligible(fields["responsible"], "responsible")
        if "name" in fields and not fields["name"]:
            raise _invalid("name", "El nombre de la fase es requerido")
        _check_phase_dates(
            fields.get("start_date", phase.start_date), fields.get("target_date", phase.target_date)
        )
        previous_status = phase.status
        new_status = fields.get("status")
        status_changed = "status" in fields and new_status != previous_status
        previous = {
            f: _audit_value(getattr(phase, f"{f}_id" if f == "responsible" else f)) for f in fields
        }

        with transaction.atomic():
            for field, value in fields.items():
                setattr(phase, field, value)
            phase.save()
            if status_changed:
                log_project_history(
                    project_id=project.id,
                    actor=actor,
                    event=ProjectHistoryEvent.FASE_ACTUALIZADA,
                    description=(
                        f'{_short_name(actor)} cambió el estado de la fase "{phase.name}" de '
                        f"{previous_status} a {new_status}"
                    ),
                    previous_value={"status": previous_status},
                    new_value={"status": new_status},
                )
            nuevos = {
                f: _audit_value(getattr(phase, f"{f}_id" if f == "responsible" else f))
                for f in fields
            }
            _audit(
                actor,
                "fase_actualizada",
                target=phase,
                previous=previous,
                new=nuevos,
                context=context,
            )
        return phase

    @staticmethod
    def delete_phase(*, actor, project: Project, phase: ProjectPhase, context=None) -> None:
        """Borrado físico (las fases no van a la papelera, como en Nexo). Sus
        actividades quedan en el proyecto, sin fase."""
        require_manager(actor, project, "No tiene permiso para eliminar fases.")
        name, phase_id = phase.name, phase.id
        with transaction.atomic():
            phase.delete()
            log_project_history(
                project_id=project.id,
                actor=actor,
                event=ProjectHistoryEvent.FASE_ELIMINADA,
                description=f'{_short_name(actor)} eliminó la fase "{name}" de "{project.name}"',
                previous_value={"phase_id": phase_id, "name": name},
            )
            _audit(
                actor,
                "fase_eliminada",
                target_type="projectphase",
                target_id=phase_id,
                previous={"project_id": project.id, "name": name},
                context=context,
            )


def _check_phase_dates(start, target) -> None:
    if start and target and target < start:
        raise _invalid("target_date", "La fecha objetivo no puede ser anterior a la de inicio.")


# ── Documentos ──────────────────────────────────────────────────────────────


def load_base64_file(file_name: str, file_data: str) -> ContentFile:
    """El base64 de Nexo (`ProjectDocument.file_data`) como archivo, para
    guardarlo en el almacenamiento. Admite el prefijo de una URL de datos
    (`data:application/pdf;base64,...`). Lo usa el endpoint de subida y lo
    usará la migración de datos de Nexo."""
    data = (file_data or "").strip()
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    try:
        contenido = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise _invalid("file_data", "El contenido del archivo no es base64 válido.") from exc
    if not contenido:
        raise _invalid("file_data", "El archivo está vacío.")
    return ContentFile(contenido, name=PurePath(file_name).name or "documento")


class DocumentService:
    @staticmethod
    def upload_document(
        *,
        actor,
        project: Project,
        file,
        file_name: str | None = None,
        category: str = ProjectDocument.Category.OTRO,
        previous_version_id: int | None = None,
        activity: ProjectActivity | None = None,
        context=None,
        check_access: bool = True,
    ) -> ProjectDocument:
        """Guarda un documento ya recibido como archivo (`UploadedFile` o el
        `ContentFile` de `load_base64_file`). Lo valida como un adjunto
        (tamaño, extensión de `DOCUMENT_FORMATS` y firma del contenido; un
        OOXML, además, por dentro): un ejecutable renombrado a `.pdf` no
        entra. `check_access=False` es solo para la
        migración de datos, que no corre como una persona."""
        if check_access:
            require_participant(actor, project, "Solo los participantes pueden subir documentos.")
        nombre = (file_name or getattr(file, "name", "") or "").strip()
        if not nombre:
            raise _invalid("file_name", "Faltan campos requeridos")
        # La extensión que se valida es la del nombre que se muestra.
        file.name = PurePath(nombre).name
        try:
            extension = validar_archivo(
                file, formatos={ext: firmas for ext, (_, firmas) in DOCUMENT_FORMATS.items()}
            )
        except drf_serializers.ValidationError as exc:
            mensaje = exc.detail[0] if isinstance(exc.detail, list) else str(exc.detail)
            raise _invalid("file", str(mensaje)) from exc
        _check_ooxml(file, extension)

        if activity is not None and activity.project_id != project.id:
            raise _invalid("activity", "Actividad inválida")

        version = 1
        if previous_version_id is not None:
            previous = ProjectDocument.objects.filter(
                id=previous_version_id, project=project
            ).first()
            if previous is None:
                raise _invalid("previous_version_id", "Versión anterior inválida")
            version = previous.version + 1

        with transaction.atomic():
            document = ProjectDocument(
                project=project,
                uploaded_by=actor,
                version=version,
                previous_version_id=previous_version_id,
                activity=activity,
                category=category,
                file_name=nombre[:255],
                mime_type=DOCUMENT_FORMATS[extension][0],
                file_size=file.size,
            )
            document.file.save(nombre, file, save=False)
            document.save()
            version_suffix = f" (v{version})" if version > 1 else ""
            log_project_history(
                project_id=project.id,
                actor=actor,
                event=ProjectHistoryEvent.DOCUMENTO_AGREGADO,
                description=(
                    f'{_short_name(actor)} subió el documento "{document.file_name}"{version_suffix} '
                    f'a "{project.name}"'
                ),
                new_value={
                    "document_id": document.id,
                    "file_name": document.file_name,
                    "version": version,
                },
            )
            _audit(
                actor,
                "documento_subido",
                target=document,
                new={
                    "project_id": project.id,
                    "file_name": document.file_name,
                    "version": version,
                    "size": document.file_size,
                },
                context=context,
            )
        return document

    @staticmethod
    def get_document(project: Project, document_id) -> ProjectDocument:
        document = (
            ProjectDocument.objects.select_related("uploaded_by")
            .filter(pk=document_id, project=project)
            .first()
        )
        if document is None:
            raise ProyectosError("Documento no encontrado.", code="not_found", status=404)
        return document


def _check_ooxml(file, extension: str) -> None:
    """Un .docx, .xlsx o .pptx tiene que ser un OOXML de verdad (ver
    `OOXML_FOLDERS`). Solo se lee el índice del ZIP, sin descomprimir nada."""
    carpeta = OOXML_FOLDERS.get(extension)
    if carpeta is None:
        return
    try:
        with zipfile.ZipFile(file) as contenedor:
            nombres = contenedor.namelist()
    except (zipfile.BadZipFile, OSError, ValueError):
        nombres = []
    finally:
        file.seek(0)
    if "[Content_Types].xml" not in nombres or not any(n.startswith(carpeta) for n in nombres):
        raise _invalid(
            "file",
            f"El contenido del archivo no corresponde a un {extension}. "
            "Verifique que no se haya renombrado la extensión.",
        )


def viewer_for(document: ProjectDocument) -> str | None:
    """Con qué visor interno se abre: «pdf», «presentacion» o `None` (se
    descarga)."""
    return VIEWERS.get(document.mime_type)


def is_viewable(document: ProjectDocument) -> bool:
    """Si se muestra dentro del sistema (visor de PDF o de presentaciones)."""
    return viewer_for(document) is not None


# ── Actividades ─────────────────────────────────────────────────────────────


def recalc_project_real_hours(project: Project) -> None:
    """Suma la duración (minutos) de las actividades y la guarda en horas."""
    total_minutes = (
        ProjectActivity.objects.filter(project=project).aggregate(total=Sum("duration"))["total"]
        or 0
    )
    project.real_hours = round_half_up(total_minutes / 60, 2)
    project.save(update_fields=["real_hours", "updated_at"])


class ActivityService:
    """Un solo método para el registro normal y el retroactivo (como en
    Nexo); sin validar solapamiento de horarios."""

    @staticmethod
    def create_activity(
        *,
        actor,
        project: Project,
        description: str,
        start_time: str,
        end_time: str,
        phase: ProjectPhase | None = None,
        comments: str = "",
        activity_date_raw: str | None = None,
        context=None,
    ) -> ProjectActivity:
        require_participant(actor, project, "Solo los participantes pueden registrar actividades.")
        if len(description.strip()) < MIN_DESCRIPTION_LENGTH:
            raise _invalid(
                "description",
                f"La descripción es obligatoria y debe tener al menos {MIN_DESCRIPTION_LENGTH} "
                "caracteres",
            )

        start_mins = time_to_minutes(start_time)
        end_mins = time_to_minutes(end_time)
        if start_mins is None or end_mins is None:
            raise _invalid("start_time", "Hora inválida")
        if end_mins <= start_mins:
            raise _invalid("end_time", "La hora fin debe ser posterior a la hora inicio")
        duration = end_mins - start_mins

        if phase is not None and phase.project_id != project.id:
            raise _invalid("phase", "Fase inválida")

        is_retroactive = False
        parsed_date = None
        backdated_created_at = None
        if activity_date_raw:
            parsed_date = parse_date_only(activity_date_raw)
            if parsed_date is None:
                raise _invalid("activity_date", "Fecha inválida")
            now = timezone.now()
            today = business_calendar_day(now)
            if parsed_date != today:
                window_days = get_effective_retroactive_window_days(now)
                if parsed_date not in retroactive_valid_dates(today, window_days):
                    raise _invalid(
                        "activity_date",
                        f"La fecha debe ser hoy, uno de los últimos {window_days} días laborables, "
                        "o el sábado/domingo inmediato anterior si aún está disponible",
                    )
                is_retroactive = True
                backdated_created_at, _ = business_day_real_range(parsed_date)

        activity_date_dt = (
            datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=dt_timezone.utc)
            if parsed_date
            else None
        )

        with transaction.atomic():
            activity = ProjectActivity.objects.create(
                project=project,
                phase=phase,
                author=actor,
                description=description.strip(),
                comments=(comments or "").strip() or None,
                start_time=start_time,
                end_time=end_time,
                duration=duration,
                is_retroactive=is_retroactive,
                activity_date=activity_date_dt,
            )
            if backdated_created_at is not None:
                ProjectActivity.objects.filter(pk=activity.pk).update(
                    created_at=backdated_created_at
                )
                activity.created_at = backdated_created_at

            recalc_project_real_hours(project)

            # Participante se es por asignación o por registrar una actividad.
            if not ProjectParticipant.objects.filter(project=project, user=actor).exists():
                ProjectParticipant.objects.create(project=project, user=actor, added_by=actor)
                log_project_history(
                    project_id=project.id,
                    actor=actor,
                    event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO,
                    description=(
                        f'{_short_name(actor)} se agregó automáticamente como participante de "{project.name}" '
                        "al registrar una actividad"
                    ),
                    new_value={"user_id": actor.id, "auto": True},
                )
            _audit(
                actor,
                "actividad_registrada",
                target=activity,
                new={
                    "project_id": project.id,
                    "duration": duration,
                    "is_retroactive": is_retroactive,
                    "activity_date": parsed_date.isoformat() if parsed_date else None,
                },
                context=context,
            )
        return activity


def access_summary(user) -> dict:
    """Qué puede hacer la persona en Proyectos (para el menú y los botones)."""
    return {
        "permissions": access.effective_codenames(user),
        "can_create": access.can_create_project(user),
        "can_supervise": access.can(user, access.SUPERVISAR),
        "is_admin": access.is_admin(user),
    }
