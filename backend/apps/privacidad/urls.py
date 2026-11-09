"""Rutas de derechos sobre datos personales, montadas en `/api/v1/privacidad/`.

Son de toda la intranet, no de un módulo: no se apagan con ninguno (ver
`views`)."""

from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.ResumenView.as_view(), name="privacidad-me"),
    # --- El titular: sin permiso, solo lo suyo ---
    path("mis-solicitudes/", views.MisSolicitudesView.as_view(), name="privacidad-mis-solicitudes"),
    path(
        "mis-solicitudes/<int:pk>/",
        views.MiSolicitudView.as_view(),
        name="privacidad-mi-solicitud",
    ),
    path("mis-datos/", views.MisDatosView.as_view(), name="privacidad-mis-datos"),
    path(
        "mis-datos/secciones/",
        views.SeccionesView.as_view(),
        name="privacidad-mis-datos-secciones",
    ),
    # --- Quien atiende: privacidad.ver / privacidad.atender ---
    path("solicitudes/", views.BandejaView.as_view(), name="privacidad-bandeja"),
    path("solicitudes/<int:pk>/", views.SolicitudView.as_view(), name="privacidad-solicitud"),
    path(
        "solicitudes/<int:pk>/estado/",
        views.CambiarEstadoView.as_view(),
        name="privacidad-solicitud-estado",
    ),
    path(
        "solicitudes/<int:pk>/datos/",
        views.DatosDelTitularView.as_view(),
        name="privacidad-solicitud-datos",
    ),
]
