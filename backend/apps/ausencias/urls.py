"""Rutas de las ausencias, montadas en `/api/v1/ausencias/` (parte del módulo
Gestión Humana: se apagan con él, ver `apps.empresas.modulos`)."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="ausencias-me"),
    path("leave-records/", views.LeaveRecordListView.as_view(), name="ausencias-leave-records"),
    path(
        "leave-records/<int:pk>/",
        views.LeaveRecordDetailView.as_view(),
        name="ausencias-leave-record-detail",
    ),
    path("special-status/", views.SpecialStatusListView.as_view(), name="ausencias-special-status"),
    path(
        "special-status/<int:pk>/",
        views.SpecialStatusDetailView.as_view(),
        name="ausencias-special-status-detail",
    ),
]
