from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    OpcionesView,
    PlantillaParaSolicitarView,
    SolicitudViewSet,
    TipoProyectoViewSet,
    TiposParaSolicitarView,
)

router = DefaultRouter()
router.register("configuracion/tipos", TipoProyectoViewSet, basename="proyectos-config-tipos")
router.register("solicitudes", SolicitudViewSet, basename="proyectos-solicitudes")

urlpatterns = [
    path("tipos/", TiposParaSolicitarView.as_view(), name="proyectos-tipos"),
    path(
        "tipos/<int:pk>/plantilla/",
        PlantillaParaSolicitarView.as_view(),
        name="proyectos-plantilla",
    ),
    path("opciones/", OpcionesView.as_view(), name="proyectos-opciones"),
] + router.urls
