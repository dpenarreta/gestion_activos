"""Rutas de Proyectos (Gestión Humana), montadas en `/api/v1/projects/`.

El prefijo es el de Nexo (`/projects/`) y no `/proyectos/`, que ya es de la
Solicitud de proyectos del módulo Institucional."""

from django.urls import path

from . import views

urlpatterns = [
    path("", views.ProjectListCreateView.as_view(), name="projects-list"),
    path("me/", views.MeView.as_view(), name="projects-me"),
    path("members/", views.MembersView.as_view(), name="projects-members"),
    path("trash/", views.ProjectTrashView.as_view(), name="projects-trash"),
    path("<int:pk>/", views.ProjectDetailView.as_view(), name="projects-detail"),
    path("<int:pk>/restore/", views.ProjectRestoreView.as_view(), name="projects-restore"),
    path("<int:pk>/permanent/", views.ProjectPermanentView.as_view(), name="projects-permanent"),
    path("<int:pk>/comments/", views.ProjectCommentsView.as_view(), name="projects-comments"),
    path("<int:pk>/history/", views.ProjectHistoryView.as_view(), name="projects-history"),
    path(
        "<int:pk>/participants/",
        views.ProjectParticipantsView.as_view(),
        name="projects-participants",
    ),
    path(
        "<int:pk>/participants/<int:participant_id>/",
        views.ParticipantDetailView.as_view(),
        name="projects-participant-detail",
    ),
    path("<int:pk>/phases/", views.ProjectPhasesView.as_view(), name="projects-phases"),
    path(
        "<int:pk>/phases/<int:phase_id>/",
        views.PhaseDetailView.as_view(),
        name="projects-phase-detail",
    ),
    path("<int:pk>/documents/", views.ProjectDocumentsView.as_view(), name="projects-documents"),
    path(
        "<int:pk>/documents/<int:document_id>/",
        views.DocumentDetailView.as_view(),
        name="projects-document-detail",
    ),
    path(
        "<int:pk>/documents/<int:document_id>/file/",
        views.DocumentFileView.as_view(),
        name="projects-document-file",
    ),
    path("<int:pk>/activities/", views.ProjectActivitiesView.as_view(), name="projects-activities"),
]
