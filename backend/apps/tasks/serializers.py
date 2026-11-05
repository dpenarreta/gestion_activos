"""Contratos de entrada y salida de Tareas y Equipo (portados de Nexo).

Las salidas son las de Nexo, para que el frontend portado no cambie; las
entradas validan tipos, rangos y longitudes coherentes con el modelo."""

from django.contrib.auth.models import Group
from rest_framework import serializers

from apps.users.models import User

from .configuracion import MAX_RETROACTIVE_NOTIFY_USERS
from .models import (
    ActivityComment,
    ActivityReason,
    Comment,
    EndDateAuditLog,
    TargetTimeAuditLog,
    Task,
    TaskActivity,
    TaskCommentView,
)
from .roles import ALL_ROLES, gh_roles_of

TEXT_MAX = 5000


class TaskUserRefSerializer(serializers.ModelSerializer):
    """Referencia mínima a una persona dentro de una tarea. `roles` lleva solo
    sus roles de Gestión Humana (no los de otros módulos)."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "roles"]
        read_only_fields = fields

    def get_roles(self, obj) -> list[dict]:
        nombres = gh_roles_of(obj)
        ids = dict(Group.objects.filter(name__in=nombres).values_list("name", "id"))
        return [{"id": ids.get(nombre), "name": nombre} for nombre in nombres]


class TaskListSerializer(serializers.ModelSerializer):
    assigned_to = TaskUserRefSerializer(read_only=True)
    created_by = TaskUserRefSerializer(read_only=True)
    comment_count = serializers.SerializerMethodField()
    has_unread_comments = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "type",
            "status",
            "priority",
            "frequency",
            "start_date",
            "end_date",
            "estimated_hours",
            "real_hours",
            "target_time_validated",
            "end_date_approval_status",
            "progress",
            "color",
            "corrected",
            "archived_month",
            "assigned_to",
            "created_by",
            "comment_count",
            "has_unread_comments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_comment_count(self, obj: Task) -> int:
        return obj.comments.count()

    def get_has_unread_comments(self, obj: Task) -> bool:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        view = TaskCommentView.objects.filter(task=obj, user=request.user).first()
        others = obj.comments.exclude(author=request.user)
        if view is None:
            return others.exists()
        return others.filter(created_at__gt=view.updated_at).exists()


class TaskCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=TEXT_MAX
    )
    priority = serializers.ChoiceField(choices=Task.Priority.choices)
    frequency = serializers.ChoiceField(choices=Task.Frequency.choices)
    type = serializers.ChoiceField(
        choices=Task.Type.choices, required=False, default=Task.Type.FIJA
    )
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField()
    estimated_hours = serializers.FloatField(min_value=0, max_value=10000)
    # El ámbito (su equipo según el organigrama) lo valida el servicio.
    assigned_to = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True))
    status = serializers.ChoiceField(
        choices=Task.Status.choices, required=False, default=Task.Status.PENDIENTE
    )


class TaskUpdateSerializer(serializers.Serializer):
    """Todos opcionales: el servicio decide cuáles puede tocar quien edita.

    `description` y `color` aceptan `null` (el formulario lo manda cuando el
    campo queda en blanco) y se normalizan a cadena vacía."""

    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=TEXT_MAX
    )
    type = serializers.ChoiceField(choices=Task.Type.choices, required=False)
    priority = serializers.ChoiceField(choices=Task.Priority.choices, required=False)
    frequency = serializers.ChoiceField(choices=Task.Frequency.choices, required=False)
    start_date = serializers.DateTimeField(required=False)
    end_date = serializers.DateTimeField(required=False)
    estimated_hours = serializers.FloatField(min_value=0, max_value=10000, required=False)
    assigned_to = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), required=False
    )
    real_hours = serializers.FloatField(min_value=0, max_value=10000, required=False)
    color = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=20)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False)

    def validate(self, attrs):
        # `validate_<campo>` no corre cuando el valor es None: se normaliza aquí.
        for campo in ("description", "color"):
            if campo in attrs and attrs.get(campo) is None:
                attrs[campo] = ""
        return attrs


class CommentSerializer(serializers.ModelSerializer):
    author = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "task", "author", "text", "created_at"]
        read_only_fields = fields


class CommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=TEXT_MAX)


class ActivitySerializer(serializers.ModelSerializer):
    author = TaskUserRefSerializer(read_only=True)
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = [
            "id",
            "task",
            "author",
            "reason",
            "start_time",
            "end_time",
            "duration",
            "description",
            "is_retroactive",
            "activity_date",
            "admin_comment",
            "modified_by_admin",
            "modified_at",
            "comment_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_comment_count(self, obj: TaskActivity) -> int:
        return obj.comments.count()


class ActivityCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=100)
    hours = serializers.IntegerField(min_value=0, max_value=23)
    minutes = serializers.IntegerField(min_value=0, max_value=59)
    description = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=TEXT_MAX
    )
    start_time = serializers.CharField(required=False, allow_null=True, default=None, max_length=5)
    end_time = serializers.CharField(required=False, allow_null=True, default=None, max_length=5)


class RetroactiveActivityCreateSerializer(serializers.Serializer):
    """Como `ActivityCreateSerializer`, con descripción obligatoria y la fecha
    del día que se registra (`AAAA-MM-DD`)."""

    reason = serializers.CharField(max_length=100)
    hours = serializers.IntegerField(min_value=0, max_value=23)
    minutes = serializers.IntegerField(min_value=0, max_value=59)
    description = serializers.CharField(max_length=TEXT_MAX)
    activity_date = serializers.CharField(source="activity_date_raw", max_length=10)
    start_time = serializers.CharField(required=False, allow_null=True, default=None, max_length=5)
    end_time = serializers.CharField(required=False, allow_null=True, default=None, max_length=5)


class AdminEditActivitySerializer(serializers.Serializer):
    hours = serializers.IntegerField(min_value=0, max_value=23)
    minutes = serializers.IntegerField(min_value=0, max_value=59)
    comment = serializers.CharField(max_length=TEXT_MAX)


class ActivityCommentSerializer(serializers.ModelSerializer):
    author = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = ActivityComment
        fields = ["id", "activity", "author", "text", "created_at"]
        read_only_fields = fields


class ActivityCommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=TEXT_MAX)


class ActivityReasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityReason
        fields = [
            "id",
            "key",
            "label",
            "description",
            "is_active",
            "is_archived",
            "archived_at",
            "assigned_roles",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ActivityReasonCreateSerializer(serializers.Serializer):
    label = serializers.CharField(allow_blank=False, max_length=255)
    description = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=TEXT_MAX
    )
    assigned_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ALL_ROLES), allow_empty=False
    )


class ActivityReasonUpdateSerializer(serializers.Serializer):
    label = serializers.CharField(allow_blank=False, required=False, max_length=255)
    description = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=TEXT_MAX
    )
    assigned_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=ALL_ROLES), allow_empty=False, required=False
    )
    is_active = serializers.BooleanField(required=False)
    is_archived = serializers.BooleanField(required=False)


class TargetTimeAuditLogSerializer(serializers.ModelSerializer):
    user = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = TargetTimeAuditLog
        fields = [
            "id",
            "user",
            "user_role",
            "previous_value",
            "new_value",
            "reason",
            "reason_detail",
            "created_at",
        ]
        read_only_fields = fields


def _otro_requiere_detalle(attrs):
    if attrs["reason"] == TargetTimeAuditLog.Reason.OTRO and not attrs.get("reason_detail"):
        raise serializers.ValidationError(
            {"reason_detail": ['Debe indicar el detalle cuando el motivo es "Otro".']}
        )
    return attrs


class TargetTimeValidateSerializer(serializers.Serializer):
    new_value = serializers.FloatField(min_value=0.01, max_value=10000)
    reason = serializers.ChoiceField(choices=TargetTimeAuditLog.Reason.choices)
    reason_detail = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=TEXT_MAX
    )

    def validate(self, attrs):
        return _otro_requiere_detalle(attrs)


class TargetTimeBulkValidateSerializer(serializers.Serializer):
    task_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=1000
    )
    new_value = serializers.FloatField(min_value=0.01, max_value=10000)
    reason = serializers.ChoiceField(choices=TargetTimeAuditLog.Reason.choices)
    reason_detail = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=TEXT_MAX
    )

    def validate(self, attrs):
        return _otro_requiere_detalle(attrs)


class EndDateAuditLogSerializer(serializers.ModelSerializer):
    user = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = EndDateAuditLog
        fields = [
            "id",
            "user",
            "user_role",
            "action",
            "previous_value",
            "new_value",
            "observaciones",
            "created_at",
        ]
        read_only_fields = fields


#: La decisión que pide el líder (verbo); distinta del evento que queda en la
#: bitácora (`EndDateAuditLog.Action`).
END_DATE_DECISION_CHOICES = (
    ("APROBAR", "Aprobar"),
    ("MODIFICAR", "Modificar"),
    ("RECHAZAR", "Rechazar"),
)


class EndDateActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=END_DATE_DECISION_CHOICES)
    new_end_date = serializers.DateTimeField(required=False, allow_null=True, default=None)
    observaciones = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=TEXT_MAX
    )

    def validate(self, attrs):
        if attrs["action"] == "MODIFICAR" and not attrs.get("new_end_date"):
            raise serializers.ValidationError(
                {"new_end_date": ['Obligatoria cuando la decisión es "MODIFICAR".']}
            )
        return attrs


class EndDateBulkApproveItemSerializer(serializers.Serializer):
    task_id = serializers.IntegerField(min_value=1)
    new_end_date = serializers.DateTimeField(required=False, allow_null=True, default=None)


class EndDateBulkApproveSerializer(serializers.Serializer):
    items = EndDateBulkApproveItemSerializer(many=True, allow_empty=False, max_length=1000)
    observaciones = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=TEXT_MAX
    )


class CorrectTaskSerializer(serializers.Serializer):
    real_hours = serializers.FloatField(
        min_value=0, max_value=10000, required=False, default=None, allow_null=True
    )
    status = serializers.ChoiceField(
        choices=Task.Status.choices, required=False, default=None, allow_null=True
    )

    def validate(self, attrs):
        if attrs.get("real_hours") is None and attrs.get("status") is None:
            raise serializers.ValidationError({"non_field_errors": ["Nada que corregir."]})
        return attrs


class PendingTaskSerializer(serializers.ModelSerializer):
    assigned_to = TaskUserRefSerializer(read_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "status",
            "type",
            "priority",
            "start_date",
            "estimated_hours",
            "real_hours",
            "target_time_validated",
            "end_date",
            "end_date_approval_status",
            "archived_month",
            "assigned_to",
        ]
        read_only_fields = fields


class CloseMonthSerializer(serializers.Serializer):
    """Año y mes del cierre (por defecto, el mes anterior) y la fecha de corte
    opcional (`AAAA-MM-DD`)."""

    year = serializers.IntegerField(min_value=2000, max_value=2100, required=False)
    month = serializers.IntegerField(min_value=1, max_value=12, required=False)
    cutoffDate = serializers.CharField(  # noqa: N815 — nombre del contrato de Nexo
        required=False, allow_null=True, allow_blank=True, max_length=10
    )

    def validate(self, attrs):
        if ("year" in attrs) != ("month" in attrs):
            raise serializers.ValidationError(
                {"non_field_errors": ["Indique el año y el mes, o ninguno."]}
            )
        return attrs


class TaskSettingsSerializer(serializers.Serializer):
    retroactive_window_business_days = serializers.IntegerField(
        min_value=1, max_value=15, required=False
    )
    horas_efectivas_dia = serializers.FloatField(min_value=0.5, max_value=24, required=False)
    horas_esperadas_mes = serializers.FloatField(min_value=1, max_value=400, required=False)
    first_comment_role = serializers.ChoiceField(choices=ALL_ROLES, required=False, allow_null=True)
    #: Vacía = el jefe inmediato de quien registra (por defecto).
    retroactive_notify_users = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        max_length=MAX_RETROACTIVE_NOTIFY_USERS,
    )

    def validate_retroactive_notify_users(self, value):
        """Solo personas activas de la empresa activa."""
        from apps.empresas.contexto import empresa_actual

        ids = list(dict.fromkeys(value))
        validos = set(
            User.objects.filter(
                pk__in=ids, is_active=True, membresias__empresa=empresa_actual()
            ).values_list("pk", flat=True)
        )
        ajenos = [i for i in ids if i not in validos]
        if ajenos:
            raise serializers.ValidationError("Elija personas activas de esta empresa.")
        return ids


class PersonSerializer(serializers.ModelSerializer):
    """Persona en un selector (a quién asignar)."""

    name = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "name", "email", "role"]
        read_only_fields = fields

    def get_name(self, obj) -> str:
        return (obj.get_full_name() or "").strip() or obj.username

    def get_role(self, obj) -> str:
        roles = gh_roles_of(obj)
        return roles[0] if roles else ""
