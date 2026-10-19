from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import FlujosParaSolicitarView, FlujoViewSet, OpcionesView, SolicitudViewSet

router = DefaultRouter()
router.register("flujos", FlujoViewSet, basename="licencias-flujos")
router.register("solicitudes", SolicitudViewSet, basename="licencias-solicitudes")

urlpatterns = [
    path("tipos/", FlujosParaSolicitarView.as_view(), name="licencias-tipos"),
    path("opciones/", OpcionesView.as_view(), name="licencias-opciones"),
] + router.urls
