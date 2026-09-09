from django.urls import path

from .views import (
    AlertasView,
    ConfiguracionAlertasView,
    DestinatariosDisponiblesView,
    EnviarPruebaView,
    HistorialEnviosView,
)

urlpatterns = [
    path("", AlertasView.as_view(), name="alertas"),
    path("configuracion/", ConfiguracionAlertasView.as_view(), name="alertas-configuracion"),
    path(
        "destinatarios/",
        DestinatariosDisponiblesView.as_view(),
        name="alertas-destinatarios",
    ),
    path("envios/", HistorialEnviosView.as_view(), name="alertas-envios"),
    path("envios/prueba/", EnviarPruebaView.as_view(), name="alertas-envio-prueba"),
]
