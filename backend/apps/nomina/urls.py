from django.urls import path

from .views import ConfiguracionView, ConsultarView, CorreoPersonalView, EnviarView, EstadoView

urlpatterns = [
    path("rol-pagos/", EstadoView.as_view(), name="rol-pagos"),
    path("rol-pagos/consultar/", ConsultarView.as_view(), name="rol-pagos-consultar"),
    path("rol-pagos/enviar/", EnviarView.as_view(), name="rol-pagos-enviar"),
    path("rol-pagos/correo-personal/", CorreoPersonalView.as_view(), name="rol-pagos-correo"),
    path("rol-pagos/configuracion/", ConfiguracionView.as_view(), name="rol-pagos-configuracion"),
]
