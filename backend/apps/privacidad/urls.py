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
    # --- Consentimiento del tratamiento de datos ---
    path("consentimiento/", views.ConsentimientoView.as_view(), name="privacidad-consentimiento"),
    path(
        "consentimiento/aviso/",
        views.AvisoView.as_view(),
        name="privacidad-consentimiento-aviso",
    ),
    path(
        "consentimiento/personas/",
        views.PersonasConsentimientoView.as_view(),
        name="privacidad-consentimiento-personas",
    ),
    path(
        "consentimiento/personas/<int:pk>/",
        views.PersonaConsentimientoView.as_view(),
        name="privacidad-consentimiento-persona",
    ),
    path(
        "consentimiento/personas/<int:pk>/restablecer/",
        views.RestablecerConsentimientoView.as_view(),
        name="privacidad-consentimiento-restablecer",
    ),
    path(
        "consentimiento/restablecer-todos/",
        views.RestablecerTodosView.as_view(),
        name="privacidad-consentimiento-restablecer-todos",
    ),
    # --- Textos de protección de datos y sus aceptaciones (US-004) ---
    path("textos/", views.TextosView.as_view(), name="privacidad-textos"),
    path("textos/<slug:clave>/", views.TextoView.as_view(), name="privacidad-texto"),
    path(
        "textos/<slug:clave>/vigente/",
        views.TextoVigenteView.as_view(),
        name="privacidad-texto-vigente",
    ),
    path(
        "textos/<slug:clave>/versiones/",
        views.VersionesTextoView.as_view(),
        name="privacidad-texto-versiones",
    ),
    path("aceptaciones/", views.AceptacionesView.as_view(), name="privacidad-aceptaciones"),
    path(
        "aceptaciones/excel/",
        views.AceptacionesExcelView.as_view(),
        name="privacidad-aceptaciones-excel",
    ),
    path(
        "aceptaciones/<int:pk>/",
        views.AceptacionView.as_view(),
        name="privacidad-aceptacion",
    ),
]
