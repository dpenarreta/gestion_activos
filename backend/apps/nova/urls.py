"""Rutas de Nova, montadas en `/api/v1/nova/` (módulo Gestión Humana)."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="nova-me"),
    path("kpi/<int:user_id>/", views.KpiView.as_view(), name="nova-kpi"),
    path("inicio/", views.InicioView.as_view(), name="nova-inicio"),
    path("chat/", views.ChatView.as_view(), name="nova-chat"),
    path(
        "conocimiento/documentos/",
        views.DocumentosView.as_view(),
        name="nova-conocimiento-documentos",
    ),
    path(
        "conocimiento/documentos/<int:pk>/",
        views.DocumentoView.as_view(),
        name="nova-conocimiento-documento",
    ),
    path(
        "conocimiento/documentos/<int:pk>/archivo/",
        views.DocumentoArchivoView.as_view(),
        name="nova-conocimiento-archivo",
    ),
    path(
        "conocimiento/documentos/<int:pk>/fragmentos/",
        views.DocumentoFragmentosView.as_view(),
        name="nova-conocimiento-fragmentos",
    ),
]
