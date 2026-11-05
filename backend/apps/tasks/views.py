"""Endpoints de Tareas y Equipo (`/api/v1/tasks/`), portados de Nexo.

Las vistas solo resuelven parámetros y delegan en `services.py`. Toda vista
exige sesión y `tareas.acceder`; cada una suma el permiso de su acción. Una
tarea que la persona no puede ver responde 404 (no se revela que existe); una
que ve pero sobre la que no puede actuar, 403. Los errores salen en el
contrato uniforme `{"error": {"code", "message", "details"}}`.

La empresa de cada petición la resuelve `X-Empresa` (ver `apps.empresas`): los
gestores de los modelos ya acotan cada consulta a ella."""

from django.http import Http404, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_client_ip, get_request_context
from apps.core.responses import error_response

from .business_time import business_calendar_day, business_day_real_range, parse_date_only
from .closure import previous_month
from .configuracion import current_settings
from .models import ActivityReason, Task, TaskActivity
from .permissions import (
    CanAccessTasks,
    CanAdministrar,
    CanCloseMonth,
    CanRegularize,
    TeamPermission,
)
from .serializers import (
    ActivityCommentCreateSerializer,
    ActivityCommentSerializer,
    ActivityCreateSerializer,
    ActivityReasonCreateSerializer,
    ActivityReasonSerializer,
    ActivityReasonUpdateSerializer,
    ActivitySerializer,
    AdminEditActivitySerializer,
    CloseMonthSerializer,
    CommentCreateSerializer,
    CommentSerializer,
    CorrectTaskSerializer,
    EndDateActionSerializer,
    EndDateAuditLogSerializer,
    EndDateBulkApproveSerializer,
    PendingTaskSerializer,
    PersonSerializer,
    RetroactiveActivityCreateSerializer,
    TargetTimeAuditLogSerializer,
    TargetTimeBulkValidateSerializer,
    TargetTimeValidateSerializer,
    TaskCreateSerializer,
    TaskListSerializer,
    TaskSettingsSerializer,
    TaskUpdateSerializer,
    TaskUserRefSerializer,
)
from .services import (
    ActivityCommentService,
    ActivityReasonService,
    ActivityService,
    CommentService,
    EndDateService,
    MonthClosureService,
    TareasError,
    TargetTimeService,
    TaskImportService,
    TaskService,
    TaskSettingsService,
    TaskValidationService,
    TeamService,
    access_summary,
)

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _primer_mensaje(detalle) -> str | None:
    """El primer mensaje legible de un error de validación anidado."""
    if isinstance(detalle, str):
        return detalle
    if isinstance(detalle, dict):
        for valor in detalle.values():
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    if isinstance(detalle, (list, tuple)):
        for valor in detalle:
            mensaje = _primer_mensaje(valor)
            if mensaje:
                return mensaje
    return None


class TareasView(APIView):
    permission_classes = [IsAuthenticated, CanAccessTasks]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, TareasError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            # El manejador común dice «Error en la solicitud.»: se pone el
            # primer motivo concreto, que es lo que la persona puede corregir.
            error = response.data.get("error")
            if isinstance(error, dict):
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def get_task(self, pk) -> Task:
        """La tarea, si la persona la puede ver; si no, 404."""
        task = (
            Task.objects.select_related("assigned_to", "created_by", "empresa")
            .filter(pk=pk)
            .first()
        )
        if task is None or not TaskService.can_access(actor=self.request.user, task=task):
            raise Http404
        return task

    def get_activity(self, task_id, activity_id) -> TaskActivity:
        """La actividad de una tarea que la persona puede ver; si no, 404."""
        task = self.get_task(task_id)
        activity = task.activities.filter(pk=activity_id).select_related("task").first()
        if activity is None:
            raise Http404
        return activity

    def task_data(self, task_or_tasks, many=False):
        return TaskListSerializer(task_or_tasks, many=many, context={"request": self.request}).data


# ── Módulo ──────────────────────────────────────────────────────────────────


class MeView(TareasView):
    """`GET /tasks/me/`: permisos efectivos, rol de Gestión Humana y si tiene
    cargo y equipo en el organigrama."""

    def get(self, request):
        return Response(access_summary(request.user))


class AssignableUsersView(TareasView):
    """`GET /tasks/assignable-users/`: a quién puede asignar tareas."""

    def get(self, request):
        personas = TeamService.assignable_users(actor=request.user)
        return Response(PersonSerializer(personas, many=True).data)


class SettingsView(TareasView):
    """`GET /tasks/settings/` (cualquiera del módulo: la interfaz necesita la
    ventana retroactiva) y `PATCH` (solo `tareas.administrar`)."""

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [IsAuthenticated(), CanAccessTasks(), CanAdministrar()]
        return super().get_permissions()

    def get(self, request):
        return Response(current_settings())

    def patch(self, request):
        values = self.validated(TaskSettingsSerializer)
        return Response(
            TaskSettingsService.update(actor=request.user, values=values, context=self.context)
        )


# ── Tareas ──────────────────────────────────────────────────────────────────


class TaskListCreateView(TareasView):
    """`GET /tasks/`: sus tareas activas (no archivadas).
    `POST /tasks/`: crea una tarea para sí o para alguien de su equipo."""

    def get(self, request):
        tasks = (
            Task.objects.filter(assigned_to=request.user, archived_month__isnull=True)
            .select_related("assigned_to", "created_by")
            .order_by("-created_at")
        )
        return Response(self.task_data(tasks, many=True))

    def post(self, request):
        data = self.validated(TaskCreateSerializer)
        task = TaskService.create_task(actor=request.user, context=self.context, **data)
        return Response(self.task_data(task), status=status.HTTP_201_CREATED)


class TaskDetailView(TareasView):
    """`GET|PATCH|DELETE /tasks/<id>/`."""

    def get(self, request, pk):
        return Response(self.task_data(self.get_task(pk)))

    def patch(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(TaskUpdateSerializer)
        task = TaskService.update_task(
            actor=request.user,
            task=task,
            fields=data,
            ip_address=get_client_ip(request),
            context=self.context,
        )
        return Response(self.task_data(task))

    def delete(self, request, pk):
        task = self.get_task(pk)
        TaskService.delete_task(actor=request.user, task=task, context=self.context)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskCommentsView(TareasView):
    """`GET|POST /tasks/<id>/comments/`. Leerlos los marca como vistos."""

    def get(self, request, pk):
        task = self.get_task(pk)
        comments = CommentService.list_and_mark_viewed(task=task, user=request.user)
        return Response(CommentSerializer(comments, many=True).data)

    def post(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(CommentCreateSerializer)
        comment = CommentService.create_comment(task=task, author=request.user, text=data["text"])
        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class TaskActivitiesView(TareasView):
    """`GET|POST /tasks/<id>/activities/`: registro de horas."""

    def get(self, request, pk):
        task = self.get_task(pk)
        activities = task.activities.select_related("author").all()
        return Response(ActivitySerializer(activities, many=True).data)

    def post(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(ActivityCreateSerializer)
        activity = ActivityService.create_activity(actor=request.user, task=task, **data)
        return Response(ActivitySerializer(activity).data, status=status.HTTP_201_CREATED)


class TaskRetroactiveActivityView(TareasView):
    """`POST /tasks/<id>/activities/retroactive/`."""

    def post(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(RetroactiveActivityCreateSerializer)
        activity = ActivityService.create_retroactive_activity(
            actor=request.user, task=task, **data
        )
        return Response(ActivitySerializer(activity).data, status=status.HTTP_201_CREATED)


class ActivityDetailView(TareasView):
    """`PATCH /tasks/<id>/activities/<activity_id>/`: edición de horas por
    quien administra el módulo. `DELETE`: solo quien las registró."""

    def patch(self, request, task_id, activity_id):
        activity = self.get_activity(task_id, activity_id)
        data = self.validated(AdminEditActivitySerializer)
        activity = ActivityService.admin_edit_activity(
            admin=request.user, activity=activity, context=self.context, **data
        )
        return Response(ActivitySerializer(activity).data)

    def delete(self, request, task_id, activity_id):
        activity = self.get_activity(task_id, activity_id)
        ActivityService.delete_activity(actor=request.user, activity=activity, context=self.context)
        return Response({"ok": True})


class ActivityCommentsView(TareasView):
    """`GET|POST /tasks/<id>/activities/<activity_id>/comments/`."""

    def get(self, request, task_id, activity_id):
        activity = self.get_activity(task_id, activity_id)
        comments = ActivityCommentService.list_comments(activity=activity)
        return Response(ActivityCommentSerializer(comments, many=True).data)

    def post(self, request, task_id, activity_id):
        activity = self.get_activity(task_id, activity_id)
        data = self.validated(ActivityCommentCreateSerializer)
        comment = ActivityCommentService.create_comment(
            actor=request.user, activity=activity, task=activity.task, text=data["text"]
        )
        return Response(ActivityCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class TargetTimeView(TareasView):
    """`GET /tasks/<id>/target-time/`: objetivo oficial, desviación e
    historial. `POST`: valida el Tiempo Objetivo (`tareas.validar`)."""

    def get(self, request, pk):
        return Response(self._info(self.get_task(pk)))

    def post(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(TargetTimeValidateSerializer)
        TargetTimeService.apply_validation(
            actor=request.user,
            task=task,
            ip_address=get_client_ip(request),
            context=self.context,
            **data,
        )
        return Response(self._info(task))

    def _info(self, task):
        info = TargetTimeService.get_info(actor=self.request.user, task=task)
        return {
            **{k: v for k, v in info.items() if k not in ("validated_by", "audit_history")},
            "validated_by": (
                TaskUserRefSerializer(info["validated_by"]).data if info["validated_by"] else None
            ),
            "audit_history": TargetTimeAuditLogSerializer(info["audit_history"], many=True).data,
        }


class EndDateView(TareasView):
    """`GET /tasks/<id>/end-date/` y `POST` (decisión del líder)."""

    def get(self, request, pk):
        return Response(self._info(self.get_task(pk)))

    def post(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(EndDateActionSerializer)
        EndDateService.apply_action(
            actor=request.user,
            task=task,
            ip_address=get_client_ip(request),
            context=self.context,
            **data,
        )
        return Response(self._info(task))

    def _info(self, task):
        info = EndDateService.get_info(actor=self.request.user, task=task)
        return {
            **{k: v for k, v in info.items() if k not in ("approved_by", "audit_history")},
            "approved_by": (
                TaskUserRefSerializer(info["approved_by"]).data if info["approved_by"] else None
            ),
            "audit_history": EndDateAuditLogSerializer(info["audit_history"], many=True).data,
        }


class CorrectTaskView(TareasView):
    """`PATCH /tasks/<id>/correct/`: corrige una tarea archivada
    (`tareas.administrar`)."""

    permission_classes = [IsAuthenticated, CanAccessTasks, CanAdministrar]

    def patch(self, request, pk):
        task = self.get_task(pk)
        data = self.validated(CorrectTaskSerializer)
        task = MonthClosureService.correct_archived_task(
            actor=request.user,
            task=task,
            real_hours=data.get("real_hours"),
            status=data.get("status"),
            context=self.context,
        )
        return Response(self.task_data(task))


# ── Regularización ──────────────────────────────────────────────────────────


class TargetTimeBulkValidateView(TareasView):
    """`POST /tasks/target-time/bulk-validate/` (`tareas.regularizar`)."""

    permission_classes = [IsAuthenticated, CanAccessTasks, CanRegularize]

    def post(self, request):
        data = self.validated(TargetTimeBulkValidateSerializer)
        result = TargetTimeService.bulk_validate(
            actor=request.user, ip_address=get_client_ip(request), context=self.context, **data
        )
        return Response(result)


class EndDateBulkApproveView(TareasView):
    """`POST /tasks/end-date/bulk-approve/` (`tareas.regularizar`)."""

    permission_classes = [IsAuthenticated, CanAccessTasks, CanRegularize]

    def post(self, request):
        data = self.validated(EndDateBulkApproveSerializer)
        result = EndDateService.bulk_approve(
            actor=request.user, ip_address=get_client_ip(request), context=self.context, **data
        )
        return Response(result)


class PendingValidationsView(TareasView):
    """`GET /tasks/validations/pending/?user_id=&role=&type=`: pendientes de
    Tiempo Objetivo o Fecha Fin y la calidad del dato (`tareas.regularizar`)."""

    permission_classes = [IsAuthenticated, CanAccessTasks, CanRegularize]

    def get(self, request):
        role, task_type, user_id = TaskValidationService.normalize_filters(
            request.query_params.get("role") or None,
            request.query_params.get("type") or None,
            request.query_params.get("user_id") or None,
        )
        tasks = TaskValidationService.list_pending(user_id=user_id, role=role, task_type=task_type)
        return Response(
            {
                "tasks": PendingTaskSerializer(tasks, many=True).data,
                "target_time_data_quality": TargetTimeService.data_quality(role=role),
                "end_date_data_quality": EndDateService.data_quality(role=role),
            }
        )


# ── Cierre de mes y repositorio ─────────────────────────────────────────────


class CloseMonthView(TareasView):
    """`GET /tasks/close-month/?year=&month=&cutoffDate=`: vista previa y meses
    terminados sin cerrar. `POST`: ejecuta el cierre (`tareas.cerrar_mes`)."""

    permission_classes = [IsAuthenticated, CanAccessTasks, CanCloseMonth]

    def _period(self, data, now):
        datos = self.validated(CloseMonthSerializer, data=data)
        if "year" in datos:
            year, month = datos["year"], datos["month"]
        else:
            year, month = previous_month(now)
        return year, month, (datos.get("cutoffDate") or None)

    @staticmethod
    def _serialize(data: dict) -> dict:
        return {**data, "cutoff_date": data["cutoff_date"].date().isoformat()}

    def get(self, request):
        now = timezone.now()
        year, month, cutoff = self._period(request.query_params.dict(), now)
        preview = MonthClosureService.preview(
            year=year, month=month, cutoff_date_raw=cutoff, now=now
        )
        return Response(
            {
                **self._serialize(preview),
                "pending_closures": MonthClosureService.pending_closures(now),
            }
        )

    def post(self, request):
        now = timezone.now()
        year, month, cutoff = self._period(request.data, now)
        result = MonthClosureService.execute(
            actor=request.user,
            year=year,
            month=month,
            cutoff_date_raw=cutoff,
            now=now,
            context=self.context,
        )
        return Response(self._serialize(result))


class RepositoryListView(TareasView):
    """`GET /tasks/repository/`: meses cerrados con sus agregados (sus tareas
    archivadas y las de su equipo)."""

    def get(self, request):
        return Response(MonthClosureService.list_repository_months(actor=request.user))


class RepositoryDetailView(TareasView):
    """`GET /tasks/repository/<year>/<month>/`."""

    def get(self, request, year: int, month: int):
        tasks = MonthClosureService.list_repository_tasks(
            actor=request.user, year=year, month=month
        )
        if tasks is None:
            return error_response("not_found", "Este mes no ha sido cerrado.", 404)
        return Response(self.task_data(tasks, many=True))


# ── Importación ─────────────────────────────────────────────────────────────


class TaskImportView(TareasView):
    """`POST /tasks/import/` (multipart, campo `file`): cada fila es
    independiente; devuelve `{imported, errors: [{row, error}]}`."""

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get("file")
        if file is None:
            return error_response("validation_error", "No se envió ningún archivo.", 400)
        rows = TaskImportService.load_rows(file)
        return Response(
            TaskImportService.import_rows(actor=request.user, rows=rows, context=self.context)
        )


class TaskTemplateView(TareasView):
    """`GET /tasks/template/`: plantilla del importador (se lee por posición
    de columna, el encabezado es decorativo)."""

    def get(self, request):
        response = HttpResponse(TaskImportService.template(), content_type=XLSX)
        response["Content-Disposition"] = 'attachment; filename="plantilla_tareas.xlsx"'
        return response


# ── Motivos de actividad y agenda del día ───────────────────────────────────


class ActivityReasonListCreateView(TareasView):
    """`GET /tasks/activity-reasons/`: todos los motivos (activos e
    inactivos). `POST`: crea uno (`tareas.administrar`)."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), CanAccessTasks(), CanAdministrar()]
        return super().get_permissions()

    def get(self, request):
        return Response(ActivityReasonSerializer(ActivityReason.objects.all(), many=True).data)

    def post(self, request):
        data = self.validated(ActivityReasonCreateSerializer)
        reason = ActivityReasonService.create(
            actor=request.user,
            label=data["label"],
            description=data.get("description"),
            assigned_roles=data["assigned_roles"],
            context=self.context,
        )
        return Response(ActivityReasonSerializer(reason).data, status=status.HTTP_201_CREATED)


class ActivityReasonDetailView(TareasView):
    """`PATCH /tasks/activity-reasons/<id>/` (`tareas.administrar`)."""

    permission_classes = [IsAuthenticated, CanAccessTasks, CanAdministrar]

    def patch(self, request, pk):
        data = self.validated(ActivityReasonUpdateSerializer)
        reason = ActivityReason.objects.filter(pk=pk).first()
        if reason is None:
            raise Http404
        reason = ActivityReasonService.update(
            actor=request.user, reason=reason, data=data, context=self.context
        )
        return Response(ActivityReasonSerializer(reason).data)


class DayScheduleView(TareasView):
    """`GET /tasks/activities/day-schedule/?date=AAAA-MM-DD`: sus actividades
    con horario en tareas SEGUIMIENTO de ese día de negocio (por defecto hoy),
    para avisar de solapamientos antes de guardar."""

    def get(self, request):
        date_param = request.query_params.get("date")
        day = parse_date_only(date_param) if date_param else business_calendar_day(timezone.now())
        if day is None:
            return error_response("validation_error", "Fecha inválida: use AAAA-MM-DD.", 400)
        start, end = business_day_real_range(day)
        activities = TaskActivity.objects.filter(
            author=request.user,
            created_at__gte=start,
            created_at__lte=end,
            start_time__isnull=False,
            end_time__isnull=False,
            task__type=Task.Type.SEGUIMIENTO,
        ).select_related("task")
        return Response(
            [
                {
                    "id": a.id,
                    "startTime": a.start_time,
                    "endTime": a.end_time,
                    "taskId": a.task_id,
                    "taskTitle": a.task.title,
                }
                for a in activities
            ]
        )


# ── Equipo ──────────────────────────────────────────────────────────────────


class TeamListView(TareasView):
    """`GET /tasks/team/` (`equipo.ver`): su equipo según el organigrama, con
    el conteo de tareas por estado, el correo enmascarado y la última
    actividad."""

    permission_classes = [IsAuthenticated, CanAccessTasks, TeamPermission]

    def get(self, request):
        return Response(TeamService.list_members(actor=request.user))


class TeamMemberTasksView(TareasView):
    """`GET /tasks/team/<user_id>/tasks/` (`equipo.ver`): las tareas activas de
    una persona de su equipo."""

    permission_classes = [IsAuthenticated, CanAccessTasks, TeamPermission]

    def get(self, request, user_id: int):
        target, tasks = TeamService.member_tasks(actor=request.user, user_id=user_id)
        role = PersonSerializer().get_role(target)
        return Response([_serialize_team_member_task(t, role) for t in tasks])


def _serialize_team_member_task(task: Task, assigned_to_role: str) -> dict:
    """La proyección de Nexo: el correo del responsable va sin enmascarar (lo
    ve su superior)."""

    def nombre(user):
        return (user.get_full_name() or "").strip() or user.username

    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "type": task.type,
        "status": task.status,
        "priority": task.priority,
        "frequency": task.frequency,
        "start_date": task.start_date.isoformat(),
        "end_date": task.end_date.isoformat(),
        "estimated_hours": task.estimated_hours,
        "real_hours": task.real_hours,
        "target_time_validated": task.target_time_validated,
        "end_date_approval_status": task.end_date_approval_status,
        "progress": task.progress,
        "color": task.color,
        "corrected": task.corrected,
        "assigned_to": {
            "id": task.assigned_to_id,
            "name": nombre(task.assigned_to),
            "email": task.assigned_to.email,
            "role": assigned_to_role,
        },
        "created_by": {"id": task.created_by_id, "name": nombre(task.created_by)},
        "comment_count": task.comment_count,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }
