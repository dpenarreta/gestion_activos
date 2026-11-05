"""Lógica de negocio de Tareas y Equipo (Gestión Humana), portada de Nexo.

Se conserva la lógica de Nexo (`apps/tasks/services.py` y `apps/team/views.py`)
con tres traducciones, todas documentadas donde ocurren:

1. **La jerarquía** sale del organigrama (`jerarquia.py`), no de la tabla
   rol → rol de Nexo: quién puede asignar a quién, quién ve las tareas de
   otro, el Repositorio y el Equipo, y a quién se avisa «hacia arriba».
2. **Los permisos** que en Nexo eran del superusuario o de `usuarios.editar`
   pasan a permisos propios del catálogo (`access.py`).
3. **Los avisos** van a la campana de la intranet (`apps.notificaciones`),
   después de confirmar la transacción, con enlace a la tarea.

Las vistas solo resuelven parámetros y delegan aquí; toda escritura en la base
y toda regla de autorización por registro viven en este módulo.
"""

import logging
import re
import unicodedata
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from io import BytesIO

import openpyxl
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q, QuerySet, Sum
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

from . import access, jerarquia
from .business_time import (
    business_calendar_day,
    business_day_real_range,
    parse_date_only,
    ranges_overlap,
    retroactive_valid_dates,
    time_to_minutes,
)
from .closure import (
    RECURRING_FREQUENCIES,
    days_in_month,
    determine_closure_type,
    next_month_start,
    next_year_month,
    period_start,
    previous_month,
    resolve_cutoff_date,
    shift_to_next_month,
)
from .configuracion import (
    business_base_for_range,
    get_effective_retroactive_window_days,
    get_first_comment_role,
    get_retroactive_notify_users,
)
from .mask_email import mask_email
from .models import (
    ActivityAuditLog,
    ActivityComment,
    ActivityReason,
    Comment,
    EndDateAuditLog,
    MonthClosure,
    TargetTimeAuditLog,
    Task,
    TaskActivity,
    TaskCommentView,
)
from .roles import ALL_ROLES, gh_role_of, gh_roles_of, role_label, role_names_of
from .rounding import round_half_up
from .task_import import VALID_FREQUENCIES, VALID_PRIORITIES, VALID_TYPES, parse_date

logger = logging.getLogger(__name__)
User = get_user_model()

AUDIT_MODULE = "tareas"

# Máximo de registros de horas de una tarea Fija (igual que en Nexo).
FIJA_MAX_ACTIVITIES = 2
FIJA_MAX_ACTIVITIES_MESSAGE = "Esta tarea fija ya alcanzó el número máximo de registros permitidos."

# Solo el responsable de la tarea puede tocar estos campos: quien la creó o su
# jefe no (igual que en Nexo).
SELF_ONLY_FIELDS = frozenset({"real_hours", "color", "status"})

# Hasta 40 casos históricos con el mismo título para la desviación.
HISTORICAL_SAMPLE_SIZE = 40

# Ventana de tareas archivadas que todavía cuentan para la calidad del dato y
# el listado de pendientes de regularizar.
REGULARIZATION_RECENT_DAYS = 60

# Filas como máximo en una importación por Excel.
MAX_IMPORT_ROWS = 2000

#: Adónde llevan los avisos de la campana (ruta del frontend).
TASK_LINK = "/admin/gestion-humana/tareas"
#: Límite del resumen de la campana (`Notificacion.resumen`).
SUMMARY_MAX = 300

ALERT_TITLES = {
    "comentario": "Tareas: nuevo comentario",
    "comentario_actividad": "Tareas: comentario en una actividad",
    "retroactivo": "Tareas: horas retroactivas",
    "horas_editadas": "Tareas: horas modificadas",
    "fecha_fin": "Tareas: fecha de finalización",
}


class TareasError(Exception):
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


def _forbidden(message: str) -> TareasError:
    return TareasError(message, code="permission_denied", status=403)


def _not_found(message: str = "No encontrado.") -> TareasError:
    return TareasError(message, code="not_found", status=404)


def _active_company():
    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA:
        return None
    return empresa


def user_display(user) -> str:
    if user is None:
        return ""
    return (user.get_full_name() or "").strip() or user.username


def _audit(actor, action: str, *, target=None, target_type=None, target_id=None, **kw):
    record_audit_event(
        actor=actor,
        action=f"tareas.{action}",
        target=target,
        target_type=target_type,
        target_id=target_id,
        module=AUDIT_MODULE,
        previous_values=kw.get("previous"),
        new_values=kw.get("new"),
        context=kw.get("context"),
    )


def _notify(users, *, category: str, message: str, task: Task) -> None:
    """Aviso en la campana de cada destinatario, DESPUÉS de confirmar la
    operación: si la campana falla, la operación no se revierte. Nunca lleva
    datos personales: solo el nombre de quien actuó y el título de la tarea."""
    destinatarios = [u for u in users if u is not None]
    if not destinatarios:
        return
    resumen = message if len(message) <= SUMMARY_MAX else message[: SUMMARY_MAX - 1] + "…"
    empresa = task.empresa
    enlace = f"{TASK_LINK}/{task.pk}"

    def enviar():
        from apps.notificaciones.services import notificar

        notificar(
            destinatarios,
            tipo=f"tareas.{category}",
            titulo=ALERT_TITLES.get(category, "Tareas"),
            resumen=resumen,
            enlace=enlace,
            empresa=empresa,
        )

    transaction.on_commit(enviar)


def _people_with_roles(role_names, empresa) -> list:
    """Cuentas activas de la empresa con alguno de los roles (globales o de su
    membresía en ESA empresa)."""
    names = [r for r in role_names if r]
    if not names or empresa is None:
        return []
    return list(
        User.objects.filter(is_active=True, membresias__empresa=empresa)
        .filter(
            Q(groups__name__in=names)
            | Q(membresias__roles__name__in=names, membresias__empresa=empresa)
        )
        .distinct()
    )


def _role_q(role: str, prefix: str = "assigned_to__") -> Q:
    """Filtro de tareas cuyo responsable tiene `role` (global o en la empresa
    activa), para los filtros por rol de la regularización."""
    condition = Q(**{f"{prefix}groups__name": role})
    empresa = _active_company()
    if empresa is not None:
        condition |= Q(
            **{f"{prefix}membresias__roles__name": role, f"{prefix}membresias__empresa": empresa}
        )
    return condition


def get_activity_reason_label_map() -> dict[str, str]:
    """`key -> label` de TODOS los motivos (activos e inactivos)."""
    return dict(ActivityReason.objects.values_list("key", "label"))


def _active_or_recent_scope() -> Q:
    recent_since = timezone.now() - timedelta(days=REGULARIZATION_RECENT_DAYS)
    return Q(archived_month__isnull=True) | Q(archived_at__gte=recent_since)


def _data_quality_from_counts(*, validated_count: int, total_count: int) -> dict:
    validated_pct = round_half_up(validated_count / total_count * 100) if total_count > 0 else 100
    return {
        "validated_count": validated_count,
        "pending_count": total_count - validated_count,
        "total_count": total_count,
        "validated_pct": validated_pct,
        "pending_pct": 100 - validated_pct,
    }


# ── Ámbito: quién ve y a quién se asigna ─────────────────────────────────────


def visible_user_ids(actor) -> set[int]:
    """Ella misma y su equipo según el organigrama."""
    return {actor.pk} | jerarquia.equipo_ids(actor)


def can_assign_to(actor, assignee) -> bool:
    """A quién puede asignar una tarea (en Nexo, `is_visible_to` por rol):

    - a sí misma;
    - a alguien de su equipo según el organigrama;
    - quien administra el módulo, a cualquiera de la empresa.

    En los dos últimos casos la persona tiene que estar activa y tener acceso
    a Tareas: una tarea que su responsable no puede abrir no sirve de nada."""
    if assignee is None:
        return False
    if assignee.pk == actor.pk:
        return True
    if not assignee.is_active:
        return False
    if access.is_admin(actor):
        empresa = _active_company()
        en_la_empresa = empresa is None or assignee.membresias.filter(empresa=empresa).exists()
        if not en_la_empresa:
            return False
    elif not jerarquia.puede_ver(actor, assignee):
        return False
    return access.can(assignee, access.ACCEDER)


def _assignee_error(nombre: str | None = None) -> TareasError:
    texto = (
        f'No puede asignar tareas a "{nombre}".'
        if nombre
        else "No puede asignar tareas a esta persona: no es de su equipo en el organigrama."
    )
    return TareasError(texto, code="assignee_out_of_scope", details={"assigned_to": [texto]})


class TaskService:
    @staticmethod
    def create_task(*, actor, context=None, **fields) -> Task:
        assigned_to = fields["assigned_to"]
        if not can_assign_to(actor, assigned_to):
            raise _assignee_error()
        if fields["end_date"] < fields["start_date"]:
            raise TareasError(
                "La fecha fin no puede ser anterior a la fecha de inicio.",
                details={"end_date": ["Debe ser igual o posterior a la fecha de inicio."]},
            )

        status = fields.get("status", Task.Status.PENDIENTE)
        with transaction.atomic():
            task = Task.objects.create(
                created_by=actor,
                progress=100 if status == Task.Status.COMPLETADA else 0,
                completed_at=timezone.now() if status == Task.Status.COMPLETADA else None,
                **fields,
            )
            _audit(
                actor,
                "crear",
                target=task,
                new={"title": task.title, "assigned_to": assigned_to.pk, "type": task.type},
                context=context,
            )
        return task

    @staticmethod
    def update_task(
        *, actor, task: Task, fields: dict, ip_address: str | None = None, context=None
    ) -> Task:
        is_self = task.assigned_to_id == actor.id
        forbidden = SELF_ONLY_FIELDS & fields.keys()
        if forbidden and not is_self:
            raise TareasError(
                "Solo el responsable de la tarea puede editar ese campo.",
                code="self_only_field",
                details={
                    "non_field_errors": [f"Campos reservados: {', '.join(sorted(forbidden))}."]
                },
            )

        if "assigned_to" in fields and not can_assign_to(actor, fields["assigned_to"]):
            raise _assignee_error()

        start = fields.get("start_date", task.start_date)
        end = fields.get("end_date", task.end_date)
        if ("start_date" in fields or "end_date" in fields) and end < start:
            raise TareasError(
                "La fecha fin no puede ser anterior a la fecha de inicio.",
                details={"end_date": ["Debe ser igual o posterior a la fecha de inicio."]},
            )

        if "status" in fields:
            new_status = fields["status"]
            if new_status == Task.Status.COMPLETADA:
                fields["progress"] = 100
                fields["completed_at"] = timezone.now()
            elif new_status == Task.Status.PENDIENTE:
                fields["progress"] = 0
                fields["completed_at"] = None
            else:
                fields["completed_at"] = None

        # Si la Fecha Fin cambia y ya había sido decidida, esa edición ES una
        # nueva solicitud de aprobación: vuelve a Pendiente y queda auditada.
        end_date_proposal = None
        if (
            "end_date" in fields
            and fields["end_date"] != task.end_date
            and task.end_date_approval_status != Task.EndDateApprovalStatus.PENDIENTE
        ):
            end_date_proposal = {"previous": task.end_date, "new": fields["end_date"]}
            fields["end_date_approval_status"] = Task.EndDateApprovalStatus.PENDIENTE
            fields["end_date_approved_at"] = None
            fields["end_date_approved_by"] = None

        previous = {k: _audit_value(getattr(task, k, None)) for k in fields}
        with transaction.atomic():
            for field, value in fields.items():
                setattr(task, field, value)
            task.save()

            if end_date_proposal:
                EndDateAuditLog.objects.create(
                    empresa_id=task.empresa_id,
                    task_id=task.id,
                    user=actor,
                    user_role=gh_role_of(actor),
                    action=EndDateAuditLog.Action.PROPUESTA,
                    previous_value=end_date_proposal["previous"],
                    new_value=end_date_proposal["new"],
                    ip_address=ip_address,
                )
            _audit(
                actor,
                "editar",
                target=task,
                previous=previous,
                new={k: _audit_value(v) for k, v in fields.items()},
                context=context,
            )
        return task

    @staticmethod
    def can_access(*, actor, task: Task) -> bool:
        """Ver, editar y comentar: el responsable, quien la creó, su jefe en
        el organigrama (cualquier nivel) y quien administra el módulo.

        En Nexo (Django) el jefe solo entraba si tenía `usuarios.editar`, y la
        visibilidad jerárquica quedaba como pendiente; aquí la da el
        organigrama, que es lo que hacía el Nexo original."""
        if task.assigned_to_id == actor.id or task.created_by_id == actor.id:
            return True
        if access.is_admin(actor):
            return True
        return task.assigned_to_id in jerarquia.equipo_ids(actor)

    @staticmethod
    def can_delete(*, actor, task: Task) -> bool:
        """Más estrecho que `can_access`: el responsable NO puede borrarla.
        Quien la creó, quien administra el módulo, o un líder con
        `tareas.validar` sobre una tarea de su equipo (en Nexo,
        `usuarios.editar`)."""
        if task.created_by_id == actor.id or access.is_admin(actor):
            return True
        return access.can(actor, access.VALIDAR) and task.assigned_to_id in jerarquia.equipo_ids(
            actor
        )

    @staticmethod
    def delete_task(*, actor, task: Task, context=None) -> None:
        if not TaskService.can_delete(actor=actor, task=task):
            raise _forbidden("No puede eliminar esta tarea: solo quien la creó o su líder.")
        snapshot = {"title": task.title, "assigned_to": task.assigned_to_id}
        task_id = task.pk
        with transaction.atomic():
            task.delete()
            _audit(
                actor,
                "eliminar",
                target_type="task",
                target_id=task_id,
                previous=snapshot,
                context=context,
            )


def _audit_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "pk"):
        return value.pk
    return value


class CommentService:
    @staticmethod
    def list_and_mark_viewed(*, task: Task, user) -> list[Comment]:
        comments = list(task.comments.select_related("author").all())
        TaskCommentView.objects.update_or_create(task=task, user=user)
        return comments

    @staticmethod
    def create_comment(*, task: Task, author, text: str) -> Comment:
        """Avisa «hacia arriba»: al jefe inmediato de quien comenta según el
        organigrama (en Nexo, a los roles de `RoleNotificationTarget` del rol
        del autor). En el PRIMER comentario de la tarea avisa además al rol
        configurado en `first_comment_role`, si lo hay. Nadie recibe dos
        avisos del mismo comentario y el autor nunca se avisa a sí mismo."""
        is_first_comment = not task.comments.exists()
        comment = Comment.objects.create(task=task, author=author, text=text)

        recipients = {u.pk: u for u in jerarquia.jefe_inmediato(author, task.empresa)}
        first_role = get_first_comment_role()
        if is_first_comment and first_role:
            for persona in _people_with_roles([first_role], task.empresa):
                recipients.setdefault(persona.pk, persona)
        recipients.pop(author.pk, None)

        if recipients:
            preview = text[:60] + ("…" if len(text) > 60 else "")
            _notify(
                recipients.values(),
                category="comentario",
                message=f'{user_display(author)} comentó en "{task.title}": {preview}',
                task=task,
            )
        return comment


class ActivityService:
    """Registro de horas: validación del motivo por rol, límite de tareas
    Fija, solapamiento horario y recálculo de `real_hours`."""

    @staticmethod
    def _check_reason(actor, reason: str) -> None:
        reason_row = ActivityReason.objects.filter(key=reason).first()
        if (
            reason_row is None
            or not reason_row.is_active
            or not role_names_of(actor).intersection(reason_row.assigned_roles or [])
        ):
            raise TareasError(
                "Motivo inválido o no disponible para su rol.",
                details={"reason": ["Motivo inválido o no disponible para su rol."]},
            )

    @staticmethod
    def _check_schedule(actor, day, start_time, end_time) -> None:
        if not (start_time and end_time):
            return
        if time_to_minutes(start_time) is None or time_to_minutes(end_time) is None:
            raise TareasError("Hora inválida: use el formato HH:MM.")
        if time_to_minutes(end_time) <= time_to_minutes(start_time):
            raise TareasError("La hora fin debe ser posterior a la hora inicio.")
        conflict = ActivityService._find_overlap_message(actor, day, start_time, end_time)
        if conflict:
            raise TareasError(conflict, code="schedule_overlap")

    @staticmethod
    def create_activity(
        *,
        actor,
        task: Task,
        reason: str,
        hours: int,
        minutes: int,
        description: str = "",
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> TaskActivity:
        ActivityService._check_reason(actor, reason)

        duration = hours * 60 + minutes
        if duration <= 0:
            raise TareasError("La duración debe ser mayor a 0.")

        if task.type == Task.Type.FIJA and task.activities.count() >= FIJA_MAX_ACTIVITIES:
            raise TareasError(FIJA_MAX_ACTIVITIES_MESSAGE, code="fija_limit")

        # El solapamiento solo aplica con hora inicio/hora fin (igual que Nexo).
        ActivityService._check_schedule(
            actor, business_calendar_day(timezone.now()), start_time, end_time
        )

        with transaction.atomic():
            activity = TaskActivity.objects.create(
                task=task,
                author=actor,
                reason=reason,
                duration=duration,
                description=description.strip(),
                start_time=start_time or None,
                end_time=end_time or None,
            )
            ActivityService._recalc_task_real_hours(task)
        return activity

    @staticmethod
    def _find_overlap_message(actor, day, start_time: str, end_time: str) -> str | None:
        """Entre TODAS las actividades del actor ese día de negocio (en tareas
        SEGUIMIENTO, nunca FIJA), una cuyo horario se solape con el nuevo."""
        start, end = business_day_real_range(day)
        candidates = TaskActivity.objects.filter(
            author=actor,
            created_at__gte=start,
            created_at__lte=end,
            start_time__isnull=False,
            end_time__isnull=False,
            task__type=Task.Type.SEGUIMIENTO,
        ).select_related("task")

        for candidate in candidates:
            if ranges_overlap(start_time, end_time, candidate.start_time, candidate.end_time):
                return (
                    f"Este horario se superpone con una actividad registrada de "
                    f"{candidate.start_time} a {candidate.end_time} en la tarea "
                    f'"{candidate.task.title}". Ajuste el horario.'
                )
        return None

    @staticmethod
    def _recalc_task_real_hours(task: Task) -> None:
        total_minutes = task.activities.aggregate(total=Sum("duration"))["total"] or 0
        task.real_hours = round_half_up(total_minutes / 60, 2)
        task.save(update_fields=["real_hours", "updated_at"])

    @staticmethod
    def create_retroactive_activity(
        *,
        actor,
        task: Task,
        reason: str,
        hours: int,
        minutes: int,
        description: str,
        activity_date_raw: str,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> TaskActivity:
        """Registro retroactivo: solo tareas SEGUIMIENTO y solo en los últimos
        días hábiles de la ventana configurada (más el fin de semana inmediato
        si hoy es lunes o martes). Avisa a los roles configurados (por
        defecto, el Coordinador Nacional)."""
        ActivityService._check_reason(actor, reason)

        if not description.strip():
            raise TareasError("La descripción es obligatoria para un registro retroactivo.")

        duration = hours * 60 + minutes
        if duration <= 0:
            raise TareasError("La duración debe ser mayor a 0.")

        parsed_date = parse_date_only(activity_date_raw)
        if parsed_date is None:
            raise TareasError("Fecha inválida: use el formato AAAA-MM-DD.")

        now = timezone.now()
        window_days = get_effective_retroactive_window_days(now)
        valid_dates = retroactive_valid_dates(business_calendar_day(now), window_days)
        if parsed_date not in valid_dates:
            raise TareasError(
                f"La fecha debe ser uno de los últimos {window_days} días laborables (no incluye "
                "hoy), o el sábado o domingo inmediato anterior si aún está disponible."
            )

        if task.type != Task.Type.SEGUIMIENTO:
            raise TareasError("El registro retroactivo solo aplica a tareas de tipo Seguimiento.")

        ActivityService._check_schedule(actor, parsed_date, start_time, end_time)

        # `created_at` dentro del rango real del día retroactivo (no «ahora»):
        # todo lo que agrupa por `created_at` atribuye las horas al día correcto.
        backdated_created_at, _ = business_day_real_range(parsed_date)
        activity_date_dt = datetime(
            parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=dt_timezone.utc
        )

        with transaction.atomic():
            activity = TaskActivity.objects.create(
                task=task,
                author=actor,
                reason=reason,
                duration=duration,
                description=description.strip(),
                is_retroactive=True,
                activity_date=activity_date_dt,
                start_time=start_time or None,
                end_time=end_time or None,
            )
            TaskActivity.objects.filter(pk=activity.pk).update(created_at=backdated_created_at)
            activity.created_at = backdated_created_at
            ActivityService._recalc_task_real_hours(task)

        # Las personas elegidas en Ajustes de tareas o, si no hay ninguna, el
        # jefe inmediato de quien registra según el organigrama (05/11/2026).
        # Si de las elegidas no queda nadie (inactivas, o la única es quien
        # registra), también se avisa al jefe inmediato: el aviso nunca se
        # pierde en silencio.
        elegidos = get_retroactive_notify_users()
        recipients = []
        if elegidos:
            recipients = [
                p
                for p in User.objects.filter(
                    pk__in=elegidos, is_active=True, membresias__empresa=task.empresa
                ).distinct()
                if p.pk != actor.pk
            ]
        if not recipients:
            recipients = [
                p for p in jerarquia.jefe_inmediato(actor, task.empresa) if p.pk != actor.pk
            ]
        _notify(
            recipients,
            category="retroactivo",
            message=(
                f"{user_display(actor)} registró horas retroactivas del {parsed_date.day:02d}/"
                f'{parsed_date.month:02d}/{parsed_date.year} en la tarea "{task.title}"'
            ),
            task=task,
        )
        return activity

    @staticmethod
    def admin_edit_activity(
        *, admin, activity: TaskActivity, hours: int, minutes: int, comment: str, context=None
    ) -> TaskActivity:
        """Edición de horas por quien administra el módulo (en Nexo, el
        superusuario). Queda en `ActivityAuditLog` y avisa al responsable."""
        if not access.is_admin(admin):
            raise _forbidden("Solo quien administra Tareas puede editar horas registradas.")
        new_duration = hours * 60 + minutes
        if new_duration <= 0:
            raise TareasError("La duración debe ser mayor a 0.")
        if not comment.strip():
            raise TareasError(
                "El comentario de modificación es obligatorio.",
                details={"comment": ["Indique por qué se modifican las horas."]},
            )

        task = activity.task
        old_duration = activity.duration
        trimmed_comment = comment.strip()
        modified_at = timezone.now()

        with transaction.atomic():
            activity.duration = new_duration
            activity.admin_comment = trimmed_comment
            activity.modified_by_admin = True
            activity.modified_at = modified_at
            activity.save(
                update_fields=[
                    "duration",
                    "admin_comment",
                    "modified_by_admin",
                    "modified_at",
                    "updated_at",
                ]
            )
            ActivityService._recalc_task_real_hours(task)
            ActivityAuditLog.objects.create(
                empresa_id=task.empresa_id,
                activity_id=activity.id,
                admin=admin,
                old_duration=old_duration,
                new_duration=new_duration,
                comment=trimmed_comment,
                modified_at=modified_at,
            )
            _audit(
                admin,
                "editar_horas",
                target=activity,
                previous={"duration": old_duration},
                new={"duration": new_duration, "comment": trimmed_comment},
                context=context,
            )
        _notify(
            [task.assigned_to],
            category="horas_editadas",
            message=(
                f'El Administrador modificó una actividad en "{task.title}": {trimmed_comment}'
            ),
            task=task,
        )
        return activity

    @staticmethod
    def delete_activity(*, actor, activity: TaskActivity, context=None) -> None:
        """Solo quien registró las horas las borra (igual que en Nexo)."""
        if activity.author_id != actor.id:
            raise _forbidden("Solo quien registró la actividad puede eliminarla.")
        task = activity.task
        snapshot = {"task": task.pk, "duration": activity.duration, "reason": activity.reason}
        activity_id = activity.pk
        with transaction.atomic():
            activity.delete()
            ActivityService._recalc_task_real_hours(task)
            _audit(
                actor,
                "eliminar_actividad",
                target_type="taskactivity",
                target_id=activity_id,
                previous=snapshot,
                context=context,
            )


class ActivityCommentService:
    @staticmethod
    def list_comments(*, activity: TaskActivity) -> list[ActivityComment]:
        return list(activity.comments.select_related("author").order_by("created_at"))

    @staticmethod
    def create_comment(*, actor, activity: TaskActivity, task: Task, text: str) -> ActivityComment:
        """Aviso BIDIRECCIONAL: a todos los que ya participaron en el hilo
        (autor de la actividad y quienes comentaron antes), menos a quien
        acaba de comentar. No depende de la jerarquía."""
        comment = ActivityComment.objects.create(activity=activity, author=actor, text=text)

        prior_commenter_ids = set(
            activity.comments.exclude(id=comment.id).values_list("author_id", flat=True).distinct()
        )
        participant_ids = {activity.author_id, *prior_commenter_ids}
        participant_ids.discard(actor.id)

        if participant_ids:
            role = gh_role_of(actor)
            quien = user_display(actor) + (f" ({role_label(role)})" if role else "")
            _notify(
                User.objects.filter(id__in=participant_ids),
                category="comentario_actividad",
                message=f'{quien} comentó en una actividad de "{task.title}"',
                task=task,
            )
        return comment


class TargetTimeService:
    """Validación del Tiempo Objetivo. Nunca toca `real_hours`."""

    @staticmethod
    def can_validate(*, actor, task: Task) -> bool:
        """`tareas.validar` (en Nexo, `usuarios.editar`) y nunca sobre una
        tarea propia."""
        return access.can(actor, access.VALIDAR) and actor.id != task.assigned_to_id

    @staticmethod
    def get_info(*, actor, task: Task) -> dict:
        official_target = (
            task.target_time_validated
            if task.target_time_validated is not None
            else task.estimated_hours
        )
        deviation_hours = round_half_up(task.real_hours - official_target, 2)
        deviation_pct = (
            round_half_up((deviation_hours / official_target) * 100)
            if official_target > 0
            else None
        )
        return {
            "estimated_hours": task.estimated_hours,
            "target_time_validated": task.target_time_validated,
            "target_time_validated_at": task.target_time_validated_at,
            "validated_by": task.target_time_validated_by,
            "is_validated": task.target_time_validated is not None,
            "official_target": official_target,
            "real_hours": task.real_hours,
            "deviation": {"hours": deviation_hours, "pct": deviation_pct},
            "can_validate": TargetTimeService.can_validate(actor=actor, task=task),
            "audit_history": list(
                TargetTimeAuditLog.objects.filter(task_id=task.id)
                .select_related("user")
                .order_by("-created_at")
            ),
            "historical_deviation": TargetTimeService._historical_deviation(task, official_target),
        }

    @staticmethod
    def _historical_deviation(task: Task, official_target: float) -> dict:
        """Promedio de `real_hours` de hasta 40 tareas COMPLETADA de la empresa
        con el mismo título, sin contar la propia. Solo informa."""
        no_data = {
            "available": False,
            "reason": "Sin historial suficiente de casos similares para comparar.",
        }
        cases = list(
            Task.objects.filter(
                title__iexact=task.title.strip(), status=Task.Status.COMPLETADA, real_hours__gt=0
            )
            .exclude(id=task.id)
            .order_by("-completed_at")
            .values_list("real_hours", flat=True)[:HISTORICAL_SAMPLE_SIZE]
        )
        if not cases or official_target <= 0:
            return no_data

        avg = sum(cases) / len(cases)
        diff_pct = round_half_up(((avg - official_target) / official_target) * 100)
        if diff_pct > 15:
            recommendation = (
                f"El tiempo real promedio supera el objetivo en un {diff_pct}%. "
                "Se recomienda revisar el estándar del proceso."
            )
        elif diff_pct < -15:
            recommendation = (
                f"El tiempo real promedio está un {abs(diff_pct)}% por debajo del objetivo. "
                "Se recomienda revisar si el estándar quedó sobreestimado."
            )
        else:
            recommendation = (
                f"El tiempo real promedio está alineado con el objetivo "
                f"(diferencia de {diff_pct}%)."
            )
        return {
            "available": True,
            "sample_size": len(cases),
            "avg_real_hours": round_half_up(avg, 2),
            "diff_pct": diff_pct,
            "recommendation": recommendation,
        }

    @staticmethod
    def apply_validation(
        *,
        actor,
        task: Task,
        new_value: float,
        reason: str,
        reason_detail: str | None,
        ip_address: str | None = None,
        context=None,
    ) -> Task:
        if not access.can(actor, access.VALIDAR):
            raise _forbidden("No tiene permiso para validar el Tiempo Objetivo.")
        if actor.id == task.assigned_to_id:
            raise TareasError(
                "No puede validar el Tiempo Objetivo de una tarea propia.", code="own_task"
            )
        TargetTimeService._save_validation(
            actor=actor,
            task=task,
            new_value=new_value,
            reason=reason,
            reason_detail=reason_detail,
            ip_address=ip_address,
            context=context,
        )
        return task

    @staticmethod
    def _save_validation(*, actor, task, new_value, reason, reason_detail, ip_address, context):
        with transaction.atomic():
            previous_value = task.target_time_validated
            task.target_time_validated = new_value
            task.target_time_validated_at = timezone.now()
            task.target_time_validated_by = actor
            task.save(
                update_fields=[
                    "target_time_validated",
                    "target_time_validated_at",
                    "target_time_validated_by",
                    "updated_at",
                ]
            )
            TargetTimeAuditLog.objects.create(
                empresa_id=task.empresa_id,
                task_id=task.id,
                user=actor,
                user_role=gh_role_of(actor),
                previous_value=previous_value,
                new_value=new_value,
                reason=reason,
                reason_detail=reason_detail,
                ip_address=ip_address,
            )
            _audit(
                actor,
                "validar_tiempo_objetivo",
                target=task,
                previous={"target_time_validated": previous_value},
                new={"target_time_validated": new_value, "reason": reason},
                context=context,
            )

    @staticmethod
    def data_quality(*, role: str | None = None) -> dict:
        """% de tareas activas o recientes con el Tiempo Objetivo validado."""
        qs = Task.objects.filter(_active_or_recent_scope())
        if role:
            qs = qs.filter(_role_q(role)).distinct()
        total_count = qs.count()
        validated_count = qs.filter(target_time_validated__isnull=False).count()
        return _data_quality_from_counts(validated_count=validated_count, total_count=total_count)

    @staticmethod
    def bulk_validate(
        *,
        actor,
        task_ids: list[int],
        new_value: float,
        reason: str,
        reason_detail: str | None,
        ip_address: str | None = None,
        context=None,
    ) -> dict:
        """El mismo valor para todas. La autorización general
        (`tareas.regularizar`) ya la exigió la vista; los ids que no existen
        en la empresa se ignoran y las tareas propias se saltan."""
        rounded_value = round_half_up(new_value, 2)
        detail = (
            reason_detail.strip()
            if isinstance(reason_detail, str) and reason_detail.strip()
            else None
        )
        tasks = list(Task.objects.filter(id__in=task_ids))
        skipped_self_assigned = [t.id for t in tasks if t.assigned_to_id == actor.id]
        eligible = [t for t in tasks if t.assigned_to_id != actor.id]
        for task in eligible:
            TargetTimeService._save_validation(
                actor=actor,
                task=task,
                new_value=rounded_value,
                reason=reason,
                reason_detail=detail,
                ip_address=ip_address,
                context=context,
            )
        return {"updated_count": len(eligible), "skipped_self_assigned": skipped_self_assigned}


class EndDateService:
    """Decisión de la Fecha Fin por el líder (mismo permiso que el Tiempo
    Objetivo)."""

    DECISIONS = {
        "APROBAR": Task.EndDateApprovalStatus.APROBADA,
        "MODIFICAR": Task.EndDateApprovalStatus.MODIFICADA,
        "RECHAZAR": Task.EndDateApprovalStatus.RECHAZADA,
    }

    @staticmethod
    def can_validate(*, actor, task: Task) -> bool:
        return access.can(actor, access.VALIDAR) and actor.id != task.assigned_to_id

    @staticmethod
    def get_info(*, actor, task: Task) -> dict:
        return {
            "end_date": task.end_date,
            "end_date_approval_status": task.end_date_approval_status,
            "end_date_approved_at": task.end_date_approved_at,
            "approved_by": task.end_date_approved_by,
            "can_validate": EndDateService.can_validate(actor=actor, task=task),
            "audit_history": list(
                EndDateAuditLog.objects.filter(task_id=task.id)
                .select_related("user")
                .order_by("-created_at")
            ),
        }

    @staticmethod
    def apply_action(
        *,
        actor,
        task: Task,
        action: str,
        new_end_date,
        observaciones: str | None,
        ip_address: str | None = None,
        context=None,
    ) -> Task:
        if not access.can(actor, access.VALIDAR):
            raise _forbidden("No tiene permiso para decidir la Fecha Fin.")
        if actor.id == task.assigned_to_id:
            raise TareasError("No puede decidir la Fecha Fin de una tarea propia.", code="own_task")
        if action == "MODIFICAR" and new_end_date is not None and new_end_date < task.start_date:
            raise TareasError(
                "La nueva fecha fin no puede ser anterior a la fecha de inicio.",
                details={"new_end_date": ["Debe ser igual o posterior a la fecha de inicio."]},
            )
        EndDateService._save_decision(
            actor=actor,
            task=task,
            action=action,
            new_end_date=new_end_date,
            observaciones=observaciones,
            ip_address=ip_address,
            context=context,
        )
        return task

    @staticmethod
    def _save_decision(*, actor, task, action, new_end_date, observaciones, ip_address, context):
        result_status = EndDateService.DECISIONS[action]
        previous_end_date = task.end_date
        new_end_date_value = new_end_date if action == "MODIFICAR" else task.end_date

        with transaction.atomic():
            task.end_date = new_end_date_value
            task.end_date_approval_status = result_status
            task.end_date_approved_at = timezone.now()
            task.end_date_approved_by = actor
            task.save(
                update_fields=[
                    "end_date",
                    "end_date_approval_status",
                    "end_date_approved_at",
                    "end_date_approved_by",
                    "updated_at",
                ]
            )
            EndDateAuditLog.objects.create(
                empresa_id=task.empresa_id,
                task_id=task.id,
                user=actor,
                user_role=gh_role_of(actor),
                action=result_status,
                previous_value=previous_end_date,
                new_value=new_end_date_value,
                observaciones=observaciones,
                ip_address=ip_address,
            )
            _audit(
                actor,
                "decidir_fecha_fin",
                target=task,
                previous={"end_date": previous_end_date.isoformat()},
                new={"end_date": new_end_date_value.isoformat(), "decision": result_status},
                context=context,
            )

        # Aviso al responsable cuando se ajusta o se rechaza (nunca al aprobar).
        if result_status in (
            Task.EndDateApprovalStatus.MODIFICADA,
            Task.EndDateApprovalStatus.RECHAZADA,
        ):

            def fmt(d):
                # La fecha fin es un día guardado como medianoche UTC (así la
                # envía la pantalla): se lee en UTC. La nueva llega convertida
                # a la hora de Ecuador por el serializador y, sin esto, salía
                # un día antes que la anterior.
                d = d.astimezone(dt_timezone.utc) if timezone.is_aware(d) else d
                return f"{d.day:02d}/{d.month:02d}/{d.year}"

            obs_suffix = f" Observación: {observaciones}" if observaciones else ""
            if result_status == Task.EndDateApprovalStatus.MODIFICADA:
                message = (
                    f'Su fecha de finalización para la actividad "{task.title}" fue ajustada por '
                    f"su jefe de {fmt(previous_end_date)} a {fmt(new_end_date_value)}.{obs_suffix}"
                )
            else:
                message = (
                    f"Su jefe rechazó la fecha de finalización propuesta "
                    f'({fmt(previous_end_date)}) para la actividad "{task.title}". '
                    f"Debe proponer una nueva fecha.{obs_suffix}"
                )
            _notify([task.assigned_to], category="fecha_fin", message=message, task=task)

    @staticmethod
    def data_quality(*, role: str | None = None) -> dict:
        """«Validada» es «no pendiente»: incluye APROBADA, MODIFICADA y también
        RECHAZADA (réplica deliberada de Nexo)."""
        qs = Task.objects.filter(_active_or_recent_scope())
        if role:
            qs = qs.filter(_role_q(role)).distinct()
        total_count = qs.count()
        pending_count = qs.filter(
            end_date_approval_status=Task.EndDateApprovalStatus.PENDIENTE
        ).count()
        return _data_quality_from_counts(
            validated_count=total_count - pending_count, total_count=total_count
        )

    @staticmethod
    def bulk_approve(
        *,
        actor,
        items: list[dict],
        observaciones: str | None,
        ip_address: str | None = None,
        context=None,
    ) -> dict:
        """Sin `new_end_date`, aprobación simple; con una fecha distinta de la
        vigente, MODIFICAR; con la misma, aprobación. Se saltan las propias y
        las fechas anteriores al inicio; los ids inexistentes se ignoran."""
        detail = (
            observaciones.strip()
            if isinstance(observaciones, str) and observaciones.strip()
            else None
        )
        tasks_by_id = {t.id: t for t in Task.objects.filter(id__in=[i["task_id"] for i in items])}

        updated_count = 0
        skipped_self_assigned: list[int] = []
        skipped_invalid_date: list[int] = []
        for item in items:
            task = tasks_by_id.get(item["task_id"])
            if task is None:
                continue
            if task.assigned_to_id == actor.id:
                skipped_self_assigned.append(task.id)
                continue
            new_end_date = item.get("new_end_date")
            action, new_end_date_value = "APROBAR", None
            if new_end_date is not None:
                if new_end_date < task.start_date:
                    skipped_invalid_date.append(task.id)
                    continue
                if new_end_date != task.end_date:
                    action, new_end_date_value = "MODIFICAR", new_end_date
            EndDateService._save_decision(
                actor=actor,
                task=task,
                action=action,
                new_end_date=new_end_date_value,
                observaciones=detail,
                ip_address=ip_address,
                context=context,
            )
            updated_count += 1
        return {
            "updated_count": updated_count,
            "skipped_self_assigned": skipped_self_assigned,
            "skipped_invalid_date": skipped_invalid_date,
        }


class TaskValidationService:
    """Pendientes de regularizar: Tiempo Objetivo O Fecha Fin (o ambas), de
    toda la empresa activa."""

    @staticmethod
    def normalize_filters(role, task_type, user_id):
        """Los valores inválidos se ignoran (no filtran), igual que Nexo."""
        role = role if role in ALL_ROLES else None
        task_type = task_type if task_type in (Task.Type.FIJA, Task.Type.SEGUIMIENTO) else None
        try:
            user_id = int(user_id) if user_id else None
        except (TypeError, ValueError):
            user_id = None
        return role, task_type, user_id

    @staticmethod
    def list_pending(
        *, user_id: int | None = None, role: str | None = None, task_type: str | None = None
    ) -> QuerySet[Task]:
        qs = Task.objects.filter(_active_or_recent_scope()).filter(
            Q(target_time_validated__isnull=True)
            | Q(end_date_approval_status=Task.EndDateApprovalStatus.PENDIENTE)
        )
        if user_id:
            qs = qs.filter(assigned_to_id=user_id)
        if task_type:
            qs = qs.filter(type=task_type)
        if role:
            qs = qs.filter(_role_q(role)).distinct()
        return qs.select_related("assigned_to").order_by("-created_at")[:300]


class MonthClosureService:
    """Motor de Cierre Inteligente. El archivado y la duplicación de
    recurrentes anclan SIEMPRE al fin de mes calendario; `cutoff_date` solo
    acota los campos informativos, nunca qué tareas se archivan."""

    _ABIERTOS = [Task.Status.PENDIENTE, Task.Status.EN_PROGRESO]
    _MESES_HACIA_ATRAS_PARA_AVISAR = 12

    @staticmethod
    def _tasks_del_periodo(month_end: datetime):
        return Task.objects.filter(archived_month__isnull=True, end_date__lt=month_end)

    @staticmethod
    def _sigue_viva(task: Task) -> bool:
        """Una tarea sin cerrar sigue viva si es recurrente o de SEGUIMIENTO."""
        if task.status not in MonthClosureService._ABIERTOS:
            return False
        return task.frequency in RECURRING_FREQUENCIES or task.type == Task.Type.SEGUIMIENTO

    @staticmethod
    def _candidate_tasks(month_end: datetime) -> list[Task]:
        return [
            t
            for t in MonthClosureService._tasks_del_periodo(month_end)
            if not MonthClosureService._sigue_viva(t)
        ]

    @staticmethod
    def _continued_tasks(month_end: datetime) -> list[Task]:
        return [
            t
            for t in MonthClosureService._tasks_del_periodo(month_end)
            if MonthClosureService._sigue_viva(t)
        ]

    @staticmethod
    def _fuentes_de_duplicado(month_end: datetime) -> list[Task]:
        """Toda recurrente del período que todavía no generó su sucesora."""
        return [
            t
            for t in MonthClosureService._tasks_del_periodo(month_end)
            if t.frequency in RECURRING_FREQUENCIES and t.successor_created_at is None
        ]

    @staticmethod
    def pending_closures(now: datetime) -> list[dict]:
        """Meses YA TERMINADOS, con tareas, que nadie cerró (del más viejo al
        más reciente)."""
        cursor_year, cursor_month = previous_month(now)
        meses: list[tuple[int, int]] = []
        for _ in range(MonthClosureService._MESES_HACIA_ATRAS_PARA_AVISAR):
            meses.append((cursor_year, cursor_month))
            cursor_year, cursor_month = (
                (cursor_year - 1, 12) if cursor_month == 1 else (cursor_year, cursor_month - 1)
            )
        cerrados = set(
            MonthClosure.objects.filter(year__gte=min(y for y, _ in meses)).values_list(
                "year", "month"
            )
        )
        pendientes = []
        for year, month in sorted(meses):
            if (year, month) in cerrados:
                continue
            if not Task.objects.filter(
                end_date__gte=period_start(year, month), end_date__lt=next_month_start(year, month)
            ).exists():
                continue
            pendientes.append({"year": year, "month": month})
        return pendientes

    @staticmethod
    def preview(*, year: int, month: int, cutoff_date_raw: str | None, now: datetime) -> dict:
        cutoff_date = resolve_cutoff_date(year, month, cutoff_date_raw, now)
        month_end = next_month_start(year, month)
        statuses = [t.status for t in MonthClosureService._candidate_tasks(month_end)]
        business = business_base_for_range(period_start(year, month).date(), cutoff_date.date())
        return {
            "year": year,
            "month": month,
            "already_closed": MonthClosure.objects.filter(month=month, year=year).exists(),
            "total": len(statuses),
            "completed": statuses.count(Task.Status.COMPLETADA),
            "pending": statuses.count(Task.Status.PENDIENTE),
            "in_progress": statuses.count(Task.Status.EN_PROGRESO),
            "continued_active": len(MonthClosureService._continued_tasks(month_end)),
            "to_duplicate": len(MonthClosureService._fuentes_de_duplicado(month_end)),
            "cutoff_date": cutoff_date,
            "closure_type": determine_closure_type(year, month, cutoff_date, now),
            "calendar_days_total": days_in_month(year, month),
            "calendar_days_considered": cutoff_date.day,
            "working_days_considered": business["business_days"],
            "working_hours_considered": business["base_hours"],
        }

    @staticmethod
    def execute(
        *, actor, year: int, month: int, cutoff_date_raw: str | None, now: datetime, context=None
    ) -> dict:
        preview = MonthClosureService.preview(
            year=year, month=month, cutoff_date_raw=cutoff_date_raw, now=now
        )
        if preview["already_closed"]:
            raise TareasError("Este mes ya fue cerrado.", code="already_closed", status=409)

        cutoff_date = preview["cutoff_date"]
        month_end = next_month_start(year, month)
        next_year, next_month = next_year_month(year, month)

        candidate_tasks = MonthClosureService._candidate_tasks(month_end)
        continued_tasks = MonthClosureService._continued_tasks(month_end)
        fuentes = MonthClosureService._fuentes_de_duplicado(month_end)

        total = len(candidate_tasks)
        completed = sum(1 for t in candidate_tasks if t.status == Task.Status.COMPLETADA)
        pending = sum(1 for t in candidate_tasks if t.status == Task.Status.PENDIENTE)
        in_progress = sum(1 for t in candidate_tasks if t.status == Task.Status.EN_PROGRESO)

        # `bulk_create` no pasa por `save()`: la empresa va explícita.
        duplicates = [
            Task(
                empresa_id=t.empresa_id,
                title=t.title,
                description=t.description,
                status=Task.Status.PENDIENTE,
                priority=t.priority,
                frequency=t.frequency,
                type=t.type,
                start_date=shift_to_next_month(t.start_date, next_year, next_month),
                end_date=shift_to_next_month(t.end_date, next_year, next_month),
                estimated_hours=t.estimated_hours,
                real_hours=0,
                progress=0,
                assigned_to_id=t.assigned_to_id,
                created_by_id=t.created_by_id,
                color=t.color,
            )
            for t in fuentes
        ]

        empresa = _active_company()
        try:
            with transaction.atomic():
                closure = MonthClosure.objects.create(
                    **({"empresa": empresa} if empresa is not None else {}),
                    month=month,
                    year=year,
                    closed_by=actor,
                    cutoff_date=cutoff_date,
                    closure_type=preview["closure_type"],
                    calendar_days_total=preview["calendar_days_total"],
                    calendar_days_considered=preview["calendar_days_considered"],
                    working_days_considered=preview["working_days_considered"],
                    working_hours_considered=preview["working_hours_considered"],
                    total_tasks=total,
                    completed_tasks=completed,
                    summary={
                        "total": total,
                        "completed": completed,
                        "pending": pending,
                        "inProgress": in_progress,
                        "duplicated": len(duplicates),
                        "continuedActive": len(continued_tasks),
                        "continuedRecurring": sum(
                            1 for t in continued_tasks if t.frequency in RECURRING_FREQUENCIES
                        ),
                    },
                )
                Task.objects.filter(id__in=[t.id for t in candidate_tasks]).update(
                    archived_month=f"{year}-{month:02d}", archived_at=timezone.now()
                )
                if duplicates:
                    Task.objects.bulk_create(duplicates)
                    Task.objects.filter(id__in=[t.id for t in fuentes]).update(
                        successor_created_at=timezone.now()
                    )
                _audit(
                    actor,
                    "cerrar_mes",
                    target=closure,
                    new={
                        "year": year,
                        "month": month,
                        "archived": total,
                        "duplicated": len(duplicates),
                    },
                    context=context,
                )
        except IntegrityError as exc:
            # Dos cierres simultáneos del mismo mes: la restricción única gana.
            raise TareasError(
                "Este mes ya fue cerrado.", code="already_closed", status=409
            ) from exc

        return {
            "archived_count": total,
            "duplicated_count": len(duplicates),
            "continued_active_count": len(continued_tasks),
            "month": month,
            "year": year,
            "next_month": next_month,
            "next_year": next_year,
            "cutoff_date": cutoff_date,
            "closure_type": preview["closure_type"],
            "calendar_days_total": preview["calendar_days_total"],
            "calendar_days_considered": preview["calendar_days_considered"],
            "working_days_considered": preview["working_days_considered"],
            "working_hours_considered": preview["working_hours_considered"],
        }

    @staticmethod
    def correct_archived_task(
        *,
        actor,
        task: Task,
        real_hours: float | None = None,
        status: str | None = None,
        context=None,
    ) -> Task:
        if not access.is_admin(actor):
            raise _forbidden("Solo quien administra Tareas corrige tareas archivadas.")
        if not task.archived_month:
            raise TareasError("Solo se pueden corregir tareas archivadas del repositorio.")
        if real_hours is None and status is None:
            raise TareasError("Nada que corregir.")

        corrections: list[dict] = []
        fields: dict = {}
        now_iso = timezone.now().isoformat()

        if real_hours is not None:
            new_real_hours = round_half_up(real_hours, 2)
            if new_real_hours != task.real_hours:
                corrections.append(
                    {
                        "taskId": task.id,
                        "field": "realHours",
                        "oldValue": task.real_hours,
                        "newValue": new_real_hours,
                        "correctedBy": actor.id,
                        "correctedAt": now_iso,
                    }
                )
                fields["real_hours"] = new_real_hours

        if status is not None and status != task.status:
            corrections.append(
                {
                    "taskId": task.id,
                    "field": "status",
                    "oldValue": task.status,
                    "newValue": status,
                    "correctedBy": actor.id,
                    "correctedAt": now_iso,
                }
            )
            fields["status"] = status
            if status == Task.Status.COMPLETADA:
                fields["progress"] = 100
                fields["completed_at"] = task.completed_at or timezone.now()
            elif status == Task.Status.PENDIENTE:
                fields["progress"] = 0
                fields["completed_at"] = None
            elif status == Task.Status.EN_PROGRESO:
                fields["completed_at"] = None

        if not corrections:
            raise TareasError("No hay cambios para guardar.")

        fields["corrected"] = True
        with transaction.atomic():
            for field, value in fields.items():
                setattr(task, field, value)
            task.save()

            closure_year, closure_month = task.archived_month.split("-")
            closure = MonthClosure.objects.filter(
                year=int(closure_year), month=int(closure_month)
            ).first()
            if closure is not None:
                existing = closure.corrections if isinstance(closure.corrections, list) else []
                closure.corrections = existing + corrections
                closure.save(update_fields=["corrections", "updated_at"])
            else:
                logger.warning(
                    "No hay cierre para archived_month=%s al corregir la tarea %s",
                    task.archived_month,
                    task.id,
                )
            _audit(
                actor,
                "corregir_archivada",
                target=task,
                new={"corrections": corrections},
                context=context,
            )
        return task

    @staticmethod
    def _repository_scope(actor) -> Q:
        """Sus tareas archivadas y las de su equipo (en Nexo-Django, solo las
        propias, a la espera de conectar la jerarquía)."""
        return Q(assigned_to_id__in=visible_user_ids(actor))

    @staticmethod
    def list_repository_months(*, actor) -> list[dict]:
        rows = Task.objects.filter(
            MonthClosureService._repository_scope(actor), archived_month__isnull=False
        ).values("archived_month", "status", "real_hours")
        aggregates: dict[str, dict] = {}
        for row in rows:
            bucket = aggregates.setdefault(
                row["archived_month"], {"total_tasks": 0, "completed_tasks": 0, "total_hours": 0.0}
            )
            bucket["total_tasks"] += 1
            if row["status"] == Task.Status.COMPLETADA:
                bucket["completed_tasks"] += 1
            bucket["total_hours"] += row["real_hours"]

        result = []
        for closure in MonthClosure.objects.order_by("-year", "-month"):
            bucket = aggregates.get(f"{closure.year}-{closure.month:02d}")
            if bucket is None:
                continue
            result.append(
                {
                    "year": closure.year,
                    "month": closure.month,
                    "total_tasks": bucket["total_tasks"],
                    "completed_tasks": bucket["completed_tasks"],
                    "total_hours": round_half_up(bucket["total_hours"], 2),
                }
            )
        return result

    @staticmethod
    def list_repository_tasks(*, actor, year: int, month: int) -> QuerySet[Task] | None:
        if not MonthClosure.objects.filter(year=year, month=month).exists():
            return None
        return (
            Task.objects.filter(
                MonthClosureService._repository_scope(actor),
                archived_month=f"{year}-{month:02d}",
            )
            .select_related("assigned_to", "created_by")
            .order_by("assigned_to__first_name", "title")
        )


class TaskImportService:
    """Importación masiva de Tareas por Excel: cada fila es independiente (un
    error no aborta las demás) y solo crea tareas. El responsable se busca por
    correo y tiene que ser de su equipo (o ella misma), como al crear a mano."""

    HEADER = [
        "Título",
        "Descripción",
        "Prioridad",
        "Frecuencia",
        "Fecha Inicio (Formato: YYYY-MM-DD)",
        "Fecha Fin (Formato: YYYY-MM-DD)",
        "Tiempo Objetivo",
        "Asignado a (correo)",
        "Tipo",
    ]

    @staticmethod
    def template() -> bytes:
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "Tareas"
        sheet.append(TaskImportService.HEADER)
        sheet.append(
            [
                "Ejemplo: Informe mensual",
                "Descripción opcional",
                "ALTA",
                "MENSUAL",
                "2026-07-01",
                "2026-07-15",
                "8",
                "persona@example.com",
                "FIJA",
            ]
        )
        for index, width in enumerate([30, 30, 15, 15, 34, 32, 18, 30, 15], start=1):
            sheet.column_dimensions[openpyxl.utils.get_column_letter(index)].width = width
        buffer = BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()

    @staticmethod
    def load_rows(file) -> list[tuple]:
        try:
            workbook = openpyxl.load_workbook(file, data_only=True, read_only=True)
        except Exception as exc:  # noqa: BLE001
            raise TareasError(
                "No se pudo leer el archivo: debe ser un Excel .xlsx válido."
            ) from exc
        sheet = workbook.worksheets[0]
        rows = [
            row
            for row in sheet.iter_rows(min_row=2, values_only=True)
            if any(cell is not None and cell != "" for cell in row)
        ]
        if len(rows) > MAX_IMPORT_ROWS:
            raise TareasError(f"El archivo supera el máximo de {MAX_IMPORT_ROWS} filas.")
        return rows

    @staticmethod
    def import_rows(*, actor, rows: list[tuple], context=None) -> dict:
        imported = 0
        errors: list[dict] = []
        empresa = _active_company()

        for index, row in enumerate(rows):
            row_num = index + 2
            padded = list(row) + [None] * (9 - len(row))
            (
                title,
                description,
                priority,
                frequency,
                start_raw,
                end_raw,
                hours_raw,
                email_raw,
                type_raw,
            ) = padded[:9]

            type_norm = str(type_raw or "").strip().upper()
            task_type = type_norm if type_norm in VALID_TYPES else "FIJA"

            if not (title and str(title).strip()):
                errors.append({"row": row_num, "error": "Título requerido"})
                continue
            if priority not in VALID_PRIORITIES:
                errors.append(
                    {
                        "row": row_num,
                        "error": f'Prioridad inválida: "{priority}". Use ALTA, MEDIA o BAJA',
                    }
                )
                continue
            if frequency not in VALID_FREQUENCIES:
                errors.append(
                    {
                        "row": row_num,
                        "error": (
                            f'Frecuencia inválida: "{frequency}". '
                            "Use MENSUAL, SEMANAL, DIARIA, QUINCENAL o PUNTUAL"
                        ),
                    }
                )
                continue

            if start_raw is None or str(start_raw).strip() == "":
                errors.append({"row": row_num, "error": "la fecha de inicio es obligatoria"})
                continue
            start_date = parse_date(start_raw)
            if start_date is None:
                errors.append(
                    {"row": row_num, "error": "formato de fecha inválido, usar YYYY-MM-DD"}
                )
                continue

            if end_raw is None or str(end_raw).strip() == "":
                errors.append({"row": row_num, "error": "la fecha de fin es obligatoria"})
                continue
            end_date = parse_date(end_raw)
            if end_date is None:
                errors.append(
                    {"row": row_num, "error": "formato de fecha inválido, usar YYYY-MM-DD"}
                )
                continue

            try:
                estimated_hours = float(str(hours_raw))
            except (TypeError, ValueError):
                errors.append({"row": row_num, "error": "Tiempo objetivo inválido"})
                continue
            if estimated_hours != estimated_hours or estimated_hours < 0:  # NaN o negativo
                errors.append({"row": row_num, "error": "Tiempo objetivo inválido"})
                continue

            assigned_to = actor
            email = str(email_raw).strip() if email_raw else ""
            if email:
                candidatos = User.objects.filter(email__iexact=email)
                if empresa is not None:
                    candidatos = candidatos.filter(membresias__empresa=empresa)
                user = candidatos.distinct().first()
                if user is None:
                    errors.append(
                        {"row": row_num, "error": f'Usuario no encontrado: "{email_raw}"'}
                    )
                    continue
                if not can_assign_to(actor, user):
                    errors.append(
                        {"row": row_num, "error": f'No puede asignar tareas a "{email_raw}"'}
                    )
                    continue
                assigned_to = user

            try:
                with transaction.atomic():
                    Task.objects.create(
                        title=str(title).strip()[:255],
                        description=str(description).strip() if description else "",
                        priority=priority,
                        frequency=frequency,
                        type=task_type,
                        start_date=datetime(
                            start_date.year,
                            start_date.month,
                            start_date.day,
                            tzinfo=dt_timezone.utc,
                        ),
                        end_date=datetime(
                            end_date.year, end_date.month, end_date.day, tzinfo=dt_timezone.utc
                        ),
                        estimated_hours=estimated_hours,
                        assigned_to=assigned_to,
                        created_by=actor,
                    )
                imported += 1
            except Exception:  # noqa: BLE001
                logger.exception("No se pudo crear la tarea importada de la fila %s", row_num)
                errors.append({"row": row_num, "error": "Error al crear la tarea"})

        _audit(
            actor,
            "importar",
            target_type="task",
            new={"imported": imported, "errors": len(errors)},
            context=context,
        )
        return {"imported": imported, "errors": errors}


# ── Motivos de actividad ────────────────────────────────────────────────────

_NO_ALNUM_RE = re.compile(r"[^A-Z0-9]+")


def slugify_activity_reason_key(label: str) -> str:
    """Normaliza a NFD, quita tildes, mayúsculas, cada tramo no alfanumérico
    pasa a `_`, y recorta los extremos; `MOTIVO` si queda vacío."""
    decomposed = unicodedata.normalize("NFD", label)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    base = _NO_ALNUM_RE.sub("_", without_marks.upper()).strip("_")
    return base or "MOTIVO"


def unique_activity_reason_key(label: str) -> str:
    """Clave única en la empresa activa (sufijo `_2`, `_3`… si ya existe)."""
    base_key = slugify_activity_reason_key(label)[:90]
    key, suffix = base_key, 2
    while ActivityReason.objects.filter(key=key).exists():
        key = f"{base_key}_{suffix}"
        suffix += 1
    return key


class ActivityReasonService:
    @staticmethod
    def create(*, actor, label: str, description: str | None, assigned_roles, context=None):
        label = label.strip()
        if not label:
            raise TareasError(
                "El nombre del motivo es obligatorio.", details={"label": ["Obligatorio."]}
            )
        with transaction.atomic():
            reason = ActivityReason.objects.create(
                key=unique_activity_reason_key(label),
                label=label,
                description=(description or "").strip(),
                assigned_roles=list(assigned_roles),
            )
            _audit(
                actor,
                "crear_motivo",
                target=reason,
                new={"key": reason.key, "label": label, "assigned_roles": reason.assigned_roles},
                context=context,
            )
        return reason

    @staticmethod
    def update(*, actor, reason: ActivityReason, data: dict, context=None) -> ActivityReason:
        """Solo lo presente. Archivar fuerza inactivo; restaurar NO lo
        reactiva (asimetría de Nexo, a propósito)."""
        if "label" in data and not data["label"].strip():
            raise TareasError(
                "El nombre del motivo es obligatorio.", details={"label": ["Obligatorio."]}
            )
        previous = {
            "label": reason.label,
            "assigned_roles": reason.assigned_roles,
            "is_active": reason.is_active,
            "is_archived": reason.is_archived,
        }
        if "label" in data:
            reason.label = data["label"].strip()
        if "description" in data:
            reason.description = (data.get("description") or "").strip()
        if "assigned_roles" in data:
            reason.assigned_roles = list(data["assigned_roles"])
        if "is_active" in data:
            reason.is_active = data["is_active"]
        if "is_archived" in data:
            reason.is_archived = data["is_archived"]
            reason.archived_at = timezone.now() if data["is_archived"] else None
            if data["is_archived"]:
                reason.is_active = False
        with transaction.atomic():
            reason.save()
            _audit(
                actor,
                "editar_motivo",
                target=reason,
                previous=previous,
                new={k: _audit_value(v) for k, v in data.items()},
                context=context,
            )
        return reason


class TaskSettingsService:
    @staticmethod
    def update(*, actor, values: dict, context=None) -> dict:
        from .configuracion import current_settings, save_settings

        if not access.is_admin(actor):
            raise _forbidden("Solo quien administra Tareas cambia sus ajustes.")
        previous = current_settings()
        with transaction.atomic():
            save_settings(values, actor)
            _audit(
                actor,
                "ajustes",
                target_type="ajustes_tareas",
                previous=previous,
                new=values,
                context=context,
            )
        return current_settings()


# ── Equipo ──────────────────────────────────────────────────────────────────


class TeamService:
    """La pantalla de Equipo: las personas del equipo según el organigrama
    (en Nexo, los roles visibles de `RoleVisibility`)."""

    EMPTY_COUNTS = {"total": 0, "completed": 0, "in_progress": 0, "pending": 0}

    @staticmethod
    def list_members(*, actor) -> list[dict]:
        from apps.authentication.models import Session

        members = list(jerarquia.equipo_de(actor, solo_activos=True))
        members.sort(key=lambda m: (user_display(m).lower(), m.pk))
        member_ids = [m.id for m in members]

        counts: dict[int, dict[str, int]] = {}
        for row in Task.objects.filter(assigned_to_id__in=member_ids).values(
            "assigned_to_id", "status"
        ):
            entry = counts.setdefault(row["assigned_to_id"], dict(TeamService.EMPTY_COUNTS))
            entry["total"] += 1
            if row["status"] == Task.Status.COMPLETADA:
                entry["completed"] += 1
            elif row["status"] == Task.Status.EN_PROGRESO:
                entry["in_progress"] += 1
            elif row["status"] == Task.Status.PENDIENTE:
                entry["pending"] += 1

        # Última señal de vida: el `last_used_at` más reciente de TODAS sus
        # sesiones (una revocada conserva el último uso real). Solo de quienes
        # ya son de su equipo: no abre una vía nueva de consulta.
        ultima = {
            row["user_id"]: row["ultima"]
            for row in Session.objects.filter(user_id__in=member_ids)
            .values("user_id")
            .annotate(ultima=Max("last_used_at"))
        }
        return [
            {
                "id": m.id,
                "name": user_display(m),
                "email": mask_email(m.email or ""),
                "role": gh_role_of(m),
                "tasks": counts.get(m.id, dict(TeamService.EMPTY_COUNTS)),
                "last_activity_at": ultima[m.id].isoformat() if ultima.get(m.id) else None,
            }
            for m in members
        ]

    @staticmethod
    def member_tasks(*, actor, user_id: int) -> tuple:
        """Tareas activas (no archivadas) de una persona de su equipo.

        - Si la cuenta no existe o no trabaja en la empresa activa: 404 (no
          se revela si existe en otra).
        - Si existe aquí pero no es de su equipo: 403, como en Nexo."""
        target = User.objects.filter(pk=user_id).first()
        empresa = _active_company()
        if target is None or (
            empresa is not None and not target.membresias.filter(empresa=empresa).exists()
        ):
            raise _not_found("Usuario no encontrado.")
        if target.pk not in jerarquia.equipo_ids(actor):
            raise _forbidden("Sin permisos para ver a este usuario: no es de su equipo.")
        tasks = (
            Task.objects.filter(assigned_to=target, archived_month__isnull=True)
            .select_related("assigned_to", "created_by")
            .annotate(comment_count=Count("comments"))
            .order_by("-created_at")
        )
        return target, list(tasks)

    @staticmethod
    def assignable_users(*, actor) -> list:
        """A quién puede asignar: ella misma y su equipo; quien administra el
        módulo, además, cualquiera de la empresa con un rol de Gestión Humana."""
        personas = {actor.pk: actor}
        if access.is_admin(actor):
            empresa = _active_company()
            for persona in _people_with_roles(ALL_ROLES, empresa):
                personas.setdefault(persona.pk, persona)
        for persona in jerarquia.equipo_de(actor, solo_activos=True):
            personas.setdefault(persona.pk, persona)
        candidatos = [
            p for p in personas.values() if p.pk == actor.pk or access.can(p, access.ACCEDER)
        ]
        return sorted(candidatos, key=lambda p: (user_display(p).lower(), p.pk))


def access_summary(user) -> dict:
    """Lo que la interfaz necesita saber de la persona en el módulo."""
    return {
        "permissions": access.effective_codenames(user),
        "role": gh_role_of(user),
        "roles": gh_roles_of(user),
        "has_cargo": jerarquia.cargo_de(user) is not None,
        "team_size": len(jerarquia.equipo_ids(user)),
        "is_admin": access.is_admin(user),
    }
