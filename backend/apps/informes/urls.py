"""Rutas de los informes ejecutivos, montadas en `/api/v1/informes/` (parte
del módulo Gestión Humana: se apagan con él, ver `apps.empresas.modulos`).

Conservan el camino de Nexo (`executive/…`, `roster/`). El Report ID se
reconoce por su forma (`NXR-…`): así una ruta literal nueva bajo `executive/`
nunca se confunde con un informe."""

from django.urls import path, re_path

from . import views

_INFORME = r"(?P<report_id>NXR-[0-9A-Z-]{6,36})"

urlpatterns = [
    path("me/", views.MeView.as_view(), name="informes-me"),
    path("roster/", views.RosterView.as_view(), name="informes-roster"),
    path("executive/", views.GenerarView.as_view(), name="informes-generar"),
    path("executive/list/", views.ListadoView.as_view(), name="informes-listado"),
    path(
        "executive/closure-status/",
        views.ClosureStatusView.as_view(),
        name="informes-closure-status",
    ),
    path(
        "executive/integrity-incidents/",
        views.IncidentesView.as_view(),
        name="informes-incidentes",
    ),
    re_path(rf"^executive/{_INFORME}/$", views.DetalleView.as_view(), name="informes-detalle"),
    re_path(
        rf"^executive/{_INFORME}/export/$", views.ExportarView.as_view(), name="informes-exportar"
    ),
    re_path(
        rf"^executive/{_INFORME}/eventos/$", views.EventoView.as_view(), name="informes-eventos"
    ),
    re_path(
        rf"^executive/{_INFORME}/audit/$", views.BitacoraView.as_view(), name="informes-bitacora"
    ),
]
