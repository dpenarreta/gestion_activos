"""Endpoints de Proyectos (`/api/v1/projects/`), portados de Nexo.

Las vistas solo resuelven parámetros y delegan en `services.py`. Toda vista
exige sesión y `proyectos_gh.acceder`. Un proyecto que la persona no puede
ver responde 404 (no se revela que existe; Nexo respondía 403); uno que ve
pero sobre el que no puede actuar, 403. Los errores salen en el contrato
uniforme `{"error": {"code", "message", "details"}}`.

La empresa de cada petición la resuelve `X-Empresa` (ver `apps.empresas`): los
gestores de los modelos ya acotan cada consulta a ella."""

from urllib.parse import quote

from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_meta import get_request_context
from apps.core.responses import error_response
from apps.descargas.middleware import marcar
from apps.permissions.permissions import Requiere

from . import permissions as access
from .models import ProjectActivity, ProjectPhase
from .serializers import (
    AddParticipantSerializer,
    CommentCreateSerializer,
    ProjectActivityCreateSerializer,
    ProjectActivitySerializer,
    ProjectCommentSerializer,
    ProjectCreateSerializer,
    ProjectDetailSerializer,
    ProjectDocumentDetailSerializer,
    ProjectDocumentListSerializer,
    ProjectDocumentUploadSerializer,
    ProjectHistorySerializer,
    ProjectListSerializer,
    ProjectParticipantSerializer,
    ProjectPhaseCreateSerializer,
    ProjectPhaseSerializer,
    ProjectPhaseUpdateSerializer,
    ProjectUpdateSerializer,
    ProjectUserRefSerializer,
)
from .services import (
    MAX_BASE64_LENGTH,
    ActivityService,
    CommentService,
    DocumentService,
    ParticipantService,
    PhaseService,
    ProjectService,
    ProyectosError,
    access_summary,
    eligible_members,
    get_visible_project,
    load_base64_file,
    viewer_for,
    visible_projects,
)

CanAccessProjects = Requiere(access.ACCEDER)


def _primer_mensaje(detalle) -> str | None:
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


class ProyectosView(APIView):
    permission_classes = [IsAuthenticated, CanAccessProjects]

    @property
    def context(self) -> dict:
        return get_request_context(self.request)

    def handle_exception(self, exc):
        if isinstance(exc, ProyectosError):
            return error_response(exc.code, exc.message, exc.status, exc.details)
        response = super().handle_exception(exc)
        if isinstance(exc, ValidationError) and isinstance(response.data, dict):
            error = response.data.get("error")
            if isinstance(error, dict):
                error["message"] = _primer_mensaje(exc.detail) or error.get("message")
        return response

    def validated(self, serializer_class, data=None):
        serializer = serializer_class(data=self.request.data if data is None else data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def project(self, pk):
        return get_visible_project(self.request.user, pk)

    def detail(self, project):
        return ProjectDetailSerializer(project, context={"request": self.request}).data


class MeView(ProyectosView):
    """`GET /projects/me/`: qué puede hacer la persona en el módulo."""

    def get(self, request):
        return Response(access_summary(request.user))


class MembersView(ProyectosView):
    """`GET /projects/members/`: a quién se puede elegir como responsable o
    participante (activos en la empresa y con acceso al módulo)."""

    def get(self, request):
        return Response(ProjectUserRefSerializer(eligible_members(), many=True).data)


class ProjectListCreateView(ProyectosView):
    """`GET /projects/`: los proyectos que ve (suyos y de su equipo).
    `POST /projects/`: crea uno (`proyectos_gh.crear`)."""

    def get(self, request):
        projects = (
            visible_projects(request.user)
            .select_related("responsible", "created_by")
            .order_by("-created_at", "-id")
        )
        return Response(
            ProjectListSerializer(projects, many=True, context={"request": request}).data
        )

    def post(self, request):
        data = dict(self.validated(ProjectCreateSerializer))
        participant_ids = data.pop("participant_ids")
        project = ProjectService.create_project(
            actor=request.user, participant_ids=participant_ids, context=self.context, **data
        )
        return Response(self.detail(project), status=status.HTTP_201_CREATED)


class ProjectTrashView(ProyectosView):
    """`GET /projects/trash/`: la papelera (`proyectos_gh.crear`)."""

    def get(self, request):
        return Response(ProjectService.trash(request.user))


class ProjectDetailView(ProyectosView):
    """`GET`, `PATCH` (gestionar) y `DELETE` (a la papelera; su creador
    o quien administra Proyectos) de `/projects/<id>/`."""

    def get(self, request, pk):
        return Response(self.detail(self.project(pk)))

    def patch(self, request, pk):
        project = self.project(pk)
        data = dict(self.validated(ProjectUpdateSerializer))
        project = ProjectService.update_project(
            actor=request.user, project=project, fields=data, context=self.context
        )
        return Response(self.detail(project))

    def delete(self, request, pk):
        project = self.project(pk)
        ProjectService.soft_delete_project(
            actor=request.user, project=project, context=self.context
        )
        return Response({"success": True})


class ProjectRestoreView(ProyectosView):
    """`POST /projects/<id>/restore/`: saca de la papelera (su creador o
    quien administra Proyectos)."""

    def post(self, request, pk):
        ProjectService.restore_project(actor=request.user, pk=pk, context=self.context)
        return Response({"success": True})


class ProjectPermanentView(ProyectosView):
    """`DELETE /projects/<id>/permanent/`: elimina para siempre (su
    creador o quien administra Proyectos; irreversible)."""

    def delete(self, request, pk):
        ProjectService.delete_project_permanently(actor=request.user, pk=pk, context=self.context)
        return Response({"success": True})


class ProjectCommentsView(ProyectosView):
    """`GET` (quien ve el proyecto) y `POST` (sus participantes) de
    `/projects/<id>/comments/`."""

    def get(self, request, pk):
        project = self.project(pk)
        comments = project.comments.select_related("author")
        return Response(ProjectCommentSerializer(comments, many=True).data)

    def post(self, request, pk):
        project = self.project(pk)
        text = self.validated(CommentCreateSerializer)["text"]
        comment = CommentService.create_comment(project=project, author=request.user, text=text)
        return Response(ProjectCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class ProjectHistoryView(ProyectosView):
    """`GET /projects/<id>/history/`: del más reciente al más antiguo."""

    def get(self, request, pk):
        project = self.project(pk)
        return Response(
            ProjectHistorySerializer(project.history.select_related("actor"), many=True).data
        )


class ProjectParticipantsView(ProyectosView):
    """`POST /projects/<id>/participants/` (gestionar). 409 si ya participa."""

    def post(self, request, pk):
        project = self.project(pk)
        user = self.validated(AddParticipantSerializer)["user"]
        participant = ParticipantService.add_participant(
            actor=request.user, project=project, user=user, context=self.context
        )
        return Response(
            ProjectParticipantSerializer(participant).data, status=status.HTTP_201_CREATED
        )


class ParticipantDetailView(ProyectosView):
    """`DELETE /projects/<id>/participants/<participant_id>/` (gestionar). No
    se puede quitar al responsable (409)."""

    def delete(self, request, pk, participant_id):
        project = self.project(pk)
        ParticipantService.remove_participant(
            actor=request.user, project=project, participant_id=participant_id, context=self.context
        )
        return Response({"success": True})


class ProjectPhasesView(ProyectosView):
    """`POST /projects/<id>/phases/` (gestionar). El listado va en el detalle."""

    def post(self, request, pk):
        project = self.project(pk)
        data = self.validated(ProjectPhaseCreateSerializer)
        phase = PhaseService.create_phase(
            actor=request.user, project=project, context=self.context, **data
        )
        return Response(ProjectPhaseSerializer(phase).data, status=status.HTTP_201_CREATED)


class PhaseDetailView(ProyectosView):
    """`PATCH` y `DELETE` de `/projects/<id>/phases/<phase_id>/` (gestionar)."""

    def patch(self, request, pk, phase_id):
        project = self.project(pk)
        phase = PhaseService.get_phase(project, phase_id)
        data = dict(self.validated(ProjectPhaseUpdateSerializer))
        phase = PhaseService.update_phase(
            actor=request.user, project=project, phase=phase, fields=data, context=self.context
        )
        return Response(ProjectPhaseSerializer(phase).data)

    def delete(self, request, pk, phase_id):
        project = self.project(pk)
        phase = PhaseService.get_phase(project, phase_id)
        PhaseService.delete_phase(
            actor=request.user, project=project, phase=phase, context=self.context
        )
        return Response({"success": True})


class ProjectDocumentsView(ProyectosView):
    """`GET /projects/<id>/documents/` (quien ve el proyecto; sin contenido) y
    `POST` (sus participantes): multipart con `file`, o JSON con `file_name`
    y `file_data` en base64 (como en Nexo; más de ~4.5 MB → 413)."""

    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, pk):
        project = self.project(pk)
        documents = project.documents.select_related("uploaded_by")
        return Response(ProjectDocumentListSerializer(documents, many=True).data)

    def post(self, request, pk):
        project = self.project(pk)
        raw = request.data.get("file_data") or ""
        if isinstance(raw, str) and len(raw) > MAX_BASE64_LENGTH:
            return error_response(
                "file_too_large",
                "El archivo es demasiado grande (máximo ~4.5 MB en base64).",
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        data = self.validated(ProjectDocumentUploadSerializer)
        archivo = data.get("file")
        nombre = (data.get("file_name") or "").strip() or None
        if archivo is None:
            archivo = load_base64_file(nombre, data["file_data"])

        activity = None
        if data.get("activity") is not None:
            activity = ProjectActivity.objects.filter(pk=data["activity"]).first()
            if activity is None:
                raise ProyectosError(
                    "Actividad inválida", details={"activity": ["Actividad inválida"]}
                )

        document = DocumentService.upload_document(
            actor=request.user,
            project=project,
            file=archivo,
            file_name=nombre,
            category=data["category"],
            previous_version_id=data.get("previous_version_id"),
            activity=activity,
            context=self.context,
        )
        return Response(
            ProjectDocumentDetailSerializer(document).data, status=status.HTTP_201_CREATED
        )


class DocumentDetailView(ProyectosView):
    """`GET /projects/<id>/documents/<document_id>/`: los datos del documento
    (el contenido, por `file_url`)."""

    def get(self, request, pk, document_id):
        project = self.project(pk)
        document = DocumentService.get_document(project, document_id)
        return Response(ProjectDocumentDetailSerializer(document).data)


class DocumentFileView(ProyectosView):
    """`GET /projects/<id>/documents/<document_id>/file/`: el archivo, con la
    misma visibilidad que el proyecto. El PDF se entrega en línea, para el
    visor interno; lo demás, o cualquiera con `?download=1`, como adjunto. La
    .pptx también se ve dentro del sistema: el visor de presentaciones la pide
    como blob y la dibuja en el navegador (el mismo contrato que el material
    de Capacitación), así que la cabecera no cambia nada para él. El tipo sale
    de la extensión validada, nunca del navegador."""

    def get(self, request, pk, document_id):
        project = self.project(pk)
        document = DocumentService.get_document(project, document_id)
        try:
            fichero = document.file.open("rb")
        except FileNotFoundError as error:
            raise Http404("El archivo ya no está disponible en el servidor.") from error
        en_linea = viewer_for(document) == "pdf" and request.query_params.get("download") != "1"
        marcar(request, modulo="proyectos_gh", proyecto=project.pk, documento=document.pk)
        respuesta = FileResponse(
            fichero, content_type=document.mime_type or "application/octet-stream"
        )
        disposicion = "inline" if en_linea else "attachment"
        respuesta["Content-Disposition"] = (
            f"{disposicion}; filename*=UTF-8''{quote(document.file_name)}"
        )
        respuesta["X-Content-Type-Options"] = "nosniff"
        return respuesta


class ProjectActivitiesView(ProyectosView):
    """`GET /projects/<id>/activities/` (quien ve el proyecto) y `POST` (sus
    participantes; con `activity_date` es retroactiva)."""

    def get(self, request, pk):
        project = self.project(pk)
        activities = project.activities.select_related("author").prefetch_related("documents")
        return Response(ProjectActivitySerializer(activities, many=True).data)

    def post(self, request, pk):
        project = self.project(pk)
        data = dict(self.validated(ProjectActivityCreateSerializer))
        phase = None
        if data.get("phase") is not None:
            phase = ProjectPhase.objects.filter(pk=data["phase"]).first()
            if phase is None:
                raise ProyectosError("Fase inválida", details={"phase": ["Fase inválida"]})
        activity = ActivityService.create_activity(
            actor=request.user,
            project=project,
            description=data["description"],
            start_time=data["start_time"],
            end_time=data["end_time"],
            phase=phase,
            comments=data.get("comments") or "",
            activity_date_raw=data.get("activity_date") or None,
            context=self.context,
        )
        return Response(ProjectActivitySerializer(activity).data, status=status.HTTP_201_CREATED)
