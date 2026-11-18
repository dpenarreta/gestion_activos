"""Rutas de la interacción con la plataforma, en `/api/v1/interaccion/`."""

from django.urls import path

from . import views

urlpatterns = [
    path("latido/", views.LatidoView.as_view(), name="interaccion-latido"),
    path("resumen/", views.ResumenView.as_view(), name="interaccion-resumen"),
]
