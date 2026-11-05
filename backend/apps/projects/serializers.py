"""Contratos de entrada y salida de Proyectos (portados de Nexo).

Las salidas son las de Nexo, para que el frontend portado cambie lo mínimo;
lo que cambia es el documento: ya no trae `file_data` (base64) sino
`file_url`, la ruta protegida que lo muestra dentro del sistema, y `viewable`
(si se abre en el visor interno). Las entradas validan tipos, rangos y
longitudes coherentes con el modelo."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.tasks.models import Task
from apps.tasks.serializers import TaskUserRefSerializer

from .models import (
    Project,
    ProjectActivity,
    ProjectComment,
    ProjectDocument,
    ProjectHistory,
    ProjectParticipant,
    ProjectPhase,
)
from .services import is_viewable, viewer_for

User = get_user_model()

TEXT_MAX = 5000
TAGS_MAX = 30
TAG_MAX_LENGTH = 50


def _active_users():
    return User.objects.filter(is_active=True)


class ProjectUserRefSerializer(TaskUserRefSerializer):
    """La referencia a una persona de Tareas (con sus roles de Gestión
    Humana)."""


class ProjectParticipantSerializer(serializers.ModelSerializer):
    user = ProjectUserRefSerializer(read_only=True)
    added_by = ProjectUserRefSerializer(read_only=True)

    class Meta:
        model = ProjectParticipant
        fields = ["id", "user", "added_by", "added_at"]
        read_only_fields = fields


class ProjectPhaseSerializer(serializers.ModelSerializer):
    """`registered_minutes` y `participants` se derivan de las actividades de
    la fase (en Nexo, `getPhaseStats`)."""

    responsible = ProjectUserRefSerializer(read_only=True)
    registered_minutes = serializers.SerializerMethodField()
    participants = serializers.SerializerMethodField()

    class Meta:
        model = ProjectPhase
        fields = [
            "id",
            "name",
            "status",
            "responsible",
            "start_date",
            "target_date",
            "progress",
            "notes",
            "target_time_hours",
            "order",
            "registered_minutes",
            "participants",
        ]
        read_only_fields = fields

    def get_registered_minutes(self, obj: ProjectPhase) -> int:
        return sum(a.duration for a in obj.activities.all())

    def get_participants(self, obj: ProjectPhase) -> list:
        seen: dict[int, str] = {}
        for activity in obj.activities.select_related("author"):
            seen.setdefault(
                activity.author_id, activity.author.first_name or activity.author.username
            )
        return [{"id": user_id, "name": name} for user_id, name in seen.items()]


class ProjectListSerializer(serializers.ModelSerializer):
    responsible = ProjectUserRefSerializer(read_only=True)
    created_by = ProjectUserRefSerializer(read_only=True)
    participant_count = serializers.SerializerMethodField()
    phase_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "description",
            "status",
            "priority",
            "area",
            "tags",
            "start_date",
            "target_date",
            "target_time_hours",
            "real_hours",
            "completed_at",
            "responsible",
            "created_by",
            "participant_count",
            "phase_count",
            "comment_count",
            "document_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_participant_count(self, obj: Project) -> int:
        return obj.participants.count()

    def get_phase_count(self, obj: Project) -> int:
        return obj.phases.count()

    def get_comment_count(self, obj: Project) -> int:
        return obj.comments.count()

    def get_document_count(self, obj: Project) -> int:
        return obj.documents.count()


class ProjectDetailSerializer(ProjectListSerializer):
    participants = ProjectParticipantSerializer(many=True, read_only=True)
    phases = ProjectPhaseSerializer(many=True, read_only=True)
    last_activity = serializers.SerializerMethodField()
    activity_count = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_participate = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + [
            "observations",
            "participants",
            "phases",
            "last_activity",
            "activity_count",
            "can_manage",
            "can_participate",
            "can_delete",
        ]
        read_only_fields = fields

    def get_last_activity(self, obj: Project) -> dict | None:
        last = obj.activities.select_related("author").order_by("-created_at", "-id").first()
        if not last:
            return None
        return {
            "author_name": last.author.first_name or last.author.username,
            "created_at": last.created_at,
        }

    def get_activity_count(self, obj: Project) -> int:
        return obj.activities.count()

    def _user(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def get_can_manage(self, obj: Project) -> bool:
        from .permissions import is_project_manager

        user = self._user()
        return bool(user) and is_project_manager(user, obj)

    def get_can_participate(self, obj: Project) -> bool:
        from .permissions import is_project_participant

        user = self._user()
        return bool(user) and is_project_participant(user, obj)

    def get_can_delete(self, obj: Project) -> bool:
        from .permissions import can_delete_project

        user = self._user()
        return bool(user) and can_delete_project(user, obj)


def _clean_tags(value: list) -> list:
    tags = [t.strip() for t in value if isinstance(t, str) and t.strip()]
    if any(len(t) > TAG_MAX_LENGTH for t in tags):
        raise serializers.ValidationError(
            f"Cada etiqueta admite hasta {TAG_MAX_LENGTH} caracteres."
        )
    return tags


class ProjectCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=TEXT_MAX
    )
    responsible = serializers.PrimaryKeyRelatedField(queryset=_active_users())
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=200
    )
    start_date = serializers.DateTimeField()
    target_date = serializers.DateTimeField()
    status = serializers.ChoiceField(
        choices=Project.Status.choices, required=False, default=Project.Status.PENDIENTE
    )
    priority = serializers.ChoiceField(choices=Task.Priority.choices)
    target_time_hours = serializers.FloatField(min_value=0.01, max_value=100000)
    tags = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=list,
        max_length=TAGS_MAX,
    )
    area = serializers.CharField(required=False, allow_blank=True, default="", max_length=255)
    observations = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=TEXT_MAX
    )

    def validate_name(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("Faltan campos requeridos")
        return stripped

    def validate_tags(self, value: list) -> list:
        return _clean_tags(value)


class ProjectUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True, max_length=TEXT_MAX)
    area = serializers.CharField(required=False, allow_blank=True, max_length=255)
    tags = serializers.ListField(
        child=serializers.CharField(allow_blank=True), required=False, max_length=TAGS_MAX
    )
    observations = serializers.CharField(required=False, allow_blank=True, max_length=TEXT_MAX)
    start_date = serializers.DateTimeField(required=False)
    target_date = serializers.DateTimeField(required=False)
    target_time_hours = serializers.FloatField(min_value=0.01, max_value=100000, required=False)
    priority = serializers.ChoiceField(choices=Task.Priority.choices, required=False)
    status = serializers.ChoiceField(choices=Project.Status.choices, required=False)
    responsible = serializers.PrimaryKeyRelatedField(queryset=_active_users(), required=False)

    def validate_name(self, value: str) -> str:
        return value.strip()

    def validate_tags(self, value: list) -> list:
        return _clean_tags(value)


class ProjectCommentSerializer(serializers.ModelSerializer):
    author = ProjectUserRefSerializer(read_only=True)

    class Meta:
        model = ProjectComment
        fields = ["id", "text", "author", "created_at"]
        read_only_fields = fields


class CommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=TEXT_MAX, allow_blank=True)

    def validate_text(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("El comentario no puede estar vacío")
        return stripped


class ProjectHistorySerializer(serializers.ModelSerializer):
    actor = ProjectUserRefSerializer(read_only=True)

    class Meta:
        model = ProjectHistory
        fields = [
            "id",
            "event",
            "description",
            "previous_value",
            "new_value",
            "actor",
            "created_at",
        ]
        read_only_fields = fields


class AddParticipantSerializer(serializers.Serializer):
    user = serializers.PrimaryKeyRelatedField(queryset=_active_users())


class ProjectPhaseCreateSerializer(serializers.Serializer):
    """`order` lo pone el servicio, no el cliente."""

    name = serializers.CharField(max_length=255, allow_blank=True)
    status = serializers.ChoiceField(
        choices=Task.Status.choices, required=False, default=Task.Status.PENDIENTE
    )
    responsible = serializers.PrimaryKeyRelatedField(
        queryset=_active_users(), required=False, allow_null=True, default=None
    )
    start_date = serializers.DateTimeField(required=False, allow_null=True, default=None)
    target_date = serializers.DateTimeField(required=False, allow_null=True, default=None)
    target_time_hours = serializers.FloatField(
        required=False, allow_null=True, default=None, min_value=0, max_value=100000
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=TEXT_MAX)

    def validate_name(self, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise serializers.ValidationError("El nombre de la fase es requerido")
        return stripped


class ProjectPhaseUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False)
    responsible = serializers.PrimaryKeyRelatedField(
        queryset=_active_users(), required=False, allow_null=True
    )
    start_date = serializers.DateTimeField(required=False, allow_null=True)
    target_date = serializers.DateTimeField(required=False, allow_null=True)
    target_time_hours = serializers.FloatField(
        required=False, allow_null=True, min_value=0, max_value=100000
    )
    notes = serializers.CharField(required=False, allow_blank=True, max_length=TEXT_MAX)
    progress = serializers.IntegerField(required=False, min_value=0, max_value=100)

    def validate_name(self, value: str) -> str:
        return value.strip()


class ProjectDocumentListSerializer(serializers.ModelSerializer):
    """Sin el contenido: el archivo se abre por `file_url` (ruta de la API,
    relativa a `/api/v1`), que exige la misma visibilidad que el proyecto.

    `viewer` dice cómo se abre dentro del sistema: «pdf» (visor de PDF),
    «presentacion» (visor de diapositivas, para la .pptx) o `null` (Word,
    Excel y el .ppt antiguo: se descargan). `viewable` es `viewer != null`."""

    uploaded_by = ProjectUserRefSerializer(read_only=True)
    activity_id = serializers.IntegerField(read_only=True)
    file_url = serializers.SerializerMethodField()
    viewable = serializers.SerializerMethodField()
    viewer = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDocument
        fields = [
            "id",
            "category",
            "file_name",
            "mime_type",
            "file_size",
            "version",
            "previous_version_id",
            "activity_id",
            "uploaded_by",
            "created_at",
            "file_url",
            "viewable",
            "viewer",
        ]
        read_only_fields = fields

    def get_file_url(self, obj: ProjectDocument) -> str:
        return f"/projects/{obj.project_id}/documents/{obj.id}/file/"

    def get_viewable(self, obj: ProjectDocument) -> bool:
        return is_viewable(obj)

    def get_viewer(self, obj: ProjectDocument) -> str | None:
        return viewer_for(obj)


class ProjectDocumentDetailSerializer(ProjectDocumentListSerializer):
    pass


class ProjectDocumentUploadSerializer(serializers.Serializer):
    """Dos formas de subir, una sola validación (la del servicio):

    - **multipart** con `file` (lo normal desde la intranet);
    - **JSON** con `file_name` y `file_data` en base64 (el contrato de Nexo,
      que se conserva para el cliente portado y la migración de datos).

    `previous_version_id` es una referencia suelta: el servicio comprueba que
    sea de este proyecto. `activity` también la comprueba el servicio."""

    file = serializers.FileField(required=False, allow_empty_file=True)
    file_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    file_data = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    category = serializers.ChoiceField(
        choices=ProjectDocument.Category.choices,
        required=False,
        default=ProjectDocument.Category.OTRO,
    )
    previous_version_id = serializers.IntegerField(
        required=False, allow_null=True, default=None, min_value=1
    )
    activity = serializers.IntegerField(required=False, allow_null=True, default=None, min_value=1)

    def validate(self, attrs):
        archivo = attrs.get("file")
        base64_data = (attrs.get("file_data") or "").strip()
        if archivo is None and not base64_data:
            raise serializers.ValidationError({"file": ["Faltan campos requeridos"]})
        if archivo is None and not (attrs.get("file_name") or "").strip():
            raise serializers.ValidationError({"file_name": ["Faltan campos requeridos"]})
        return attrs


class ProjectActivityDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectDocument
        fields = ["id", "file_name", "category", "mime_type"]
        read_only_fields = fields


class ProjectActivitySerializer(serializers.ModelSerializer):
    author = ProjectUserRefSerializer(read_only=True)
    documents = ProjectActivityDocumentSerializer(many=True, read_only=True)
    phase_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProjectActivity
        fields = [
            "id",
            "phase_id",
            "description",
            "comments",
            "start_time",
            "end_time",
            "duration",
            "is_retroactive",
            "activity_date",
            "author",
            "created_at",
            "documents",
        ]
        read_only_fields = fields


class ProjectActivityCreateSerializer(serializers.Serializer):
    """`activity_date` es texto: lo interpreta el servicio (`parse_date_only`),
    con el mensaje de Nexo («Fecha inválida»). `phase` es un id: el servicio
    comprueba que sea de este proyecto."""

    description = serializers.CharField(max_length=TEXT_MAX, allow_blank=True)
    comments = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default="", max_length=TEXT_MAX
    )
    start_time = serializers.CharField(max_length=5)
    end_time = serializers.CharField(max_length=5)
    phase = serializers.IntegerField(required=False, allow_null=True, default=None, min_value=1)
    activity_date = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=10
    )
