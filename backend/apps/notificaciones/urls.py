from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("", views.NotificacionViewSet, basename="notificaciones")

# Antes que las del router: registrado en «», su `/{pk}/` tomaría
# «dispositivos» como el id de una notificación.
urlpatterns = [
    path(
        "dispositivos/",
        views.DispositivoRegistroView.as_view(),
        name="notificaciones-dispositivos",
    ),
    path(
        "dispositivos/baja/",
        views.DispositivoBajaView.as_view(),
        name="notificaciones-dispositivos-baja",
    ),
    *router.urls,
]
