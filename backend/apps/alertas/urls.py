from django.urls import path

from .views import AlertasView, ConfiguracionAlertasView

urlpatterns = [
    path("", AlertasView.as_view(), name="alertas"),
    path("configuracion/", ConfiguracionAlertasView.as_view(), name="alertas-configuracion"),
]
