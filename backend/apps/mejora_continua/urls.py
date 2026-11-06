"""Rutas de Mejora continua, montadas en `/api/v1/mejora-continua/` (parte del
módulo Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

Conservan el camino de Nexo bajo `ideas/` (`/api/ideas/<id>/vote`,
`/status`, `/history`) y suman `me/` y el adjunto como archivo."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="mejora-continua-me"),
    path("ideas/", views.IdeaListCreateView.as_view(), name="mejora-continua-ideas"),
    path("ideas/<int:pk>/", views.IdeaDetailView.as_view(), name="mejora-continua-idea"),
    path(
        "ideas/<int:pk>/status/",
        views.IdeaStatusView.as_view(),
        name="mejora-continua-idea-status",
    ),
    path("ideas/<int:pk>/vote/", views.IdeaVoteView.as_view(), name="mejora-continua-idea-vote"),
    path(
        "ideas/<int:pk>/history/",
        views.IdeaHistoryView.as_view(),
        name="mejora-continua-idea-history",
    ),
    path(
        "ideas/<int:pk>/attachment/",
        views.IdeaAttachmentView.as_view(),
        name="mejora-continua-idea-attachment",
    ),
]
