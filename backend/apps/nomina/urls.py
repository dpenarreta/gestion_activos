from django.urls import path

from .views import (
    AdjuntoObservacionView,
    ConfiguracionView,
    ConformidadView,
    ConsultarView,
    CorregirObservacionView,
    CorreoPersonalView,
    DescargaMasivaView,
    EnviarView,
    EstadoView,
    HabilitadosView,
    HistorialView,
    MisObservacionesView,
    ObservacionesView,
    ResumenObservacionesView,
    RolDelHistorialView,
)

urlpatterns = [
    path("rol-pagos/", EstadoView.as_view(), name="rol-pagos"),
    path("rol-pagos/consultar/", ConsultarView.as_view(), name="rol-pagos-consultar"),
    path("rol-pagos/enviar/", EnviarView.as_view(), name="rol-pagos-enviar"),
    path("rol-pagos/conformidad/", ConformidadView.as_view(), name="rol-pagos-conformidad"),
    path("historial/", HistorialView.as_view(), name="rol-historial"),
    path("historial/rol/", RolDelHistorialView.as_view(), name="rol-historial-rol"),
    path("observaciones/", ObservacionesView.as_view(), name="rol-observaciones"),
    path(
        "observaciones/resumen/",
        ResumenObservacionesView.as_view(),
        name="rol-observaciones-resumen",
    ),
    path("observaciones/<int:pk>/", ObservacionesView.as_view(), name="rol-observacion"),
    path(
        "observaciones/<int:pk>/corregir/",
        CorregirObservacionView.as_view(),
        name="rol-observacion-corregir",
    ),
    path(
        "observaciones/adjuntos/<int:pk>/",
        AdjuntoObservacionView.as_view(),
        name="rol-observacion-adjunto",
    ),
    path("rol-pagos/correo-personal/", CorreoPersonalView.as_view(), name="rol-pagos-correo"),
    path("rol-pagos/configuracion/", ConfiguracionView.as_view(), name="rol-pagos-configuracion"),
    path(
        "rol-pagos/descarga-masiva/", DescargaMasivaView.as_view(), name="rol-pagos-descarga-masiva"
    ),
    path("rol-pagos/habilitados/", HabilitadosView.as_view(), name="rol-pagos-habilitados"),
    path(
        "rol-pagos/mis-observaciones/",
        MisObservacionesView.as_view(),
        name="rol-pagos-mis-observaciones",
    ),
]
