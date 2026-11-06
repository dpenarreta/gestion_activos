"""Rutas de Reuniones, montadas en `/api/v1/reuniones/` (parte del módulo
Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

Conservan el camino de Nexo bajo `meetings/` y suman `me/`, `invitables/` (lo
que en Nexo era `/api/users/assignable`) y la asistencia."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="reuniones-me"),
    path("invitables/", views.InvitablesView.as_view(), name="reuniones-invitables"),
    path("meetings/", views.MeetingListCreateView.as_view(), name="reuniones-meetings"),
    path("meetings/<int:pk>/", views.MeetingDetailView.as_view(), name="reuniones-meeting"),
    path(
        "meetings/<int:pk>/attendance/",
        views.MeetingAttendanceView.as_view(),
        name="reuniones-meeting-attendance",
    ),
]
