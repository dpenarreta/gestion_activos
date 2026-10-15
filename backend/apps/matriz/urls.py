from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AreaViewSet, EntidadControlViewSet, mis_empresas

router = DefaultRouter()
router.register("catalogos/areas", AreaViewSet, basename="matriz-areas")
router.register(
    "catalogos/entidades-control", EntidadControlViewSet, basename="matriz-entidades-control"
)

# «empresas/mias» va antes que el router por la misma razón que en empresas:
# así nunca la captura una ruta de detalle.
urlpatterns = [path("empresas/mias/", mis_empresas, name="matriz-mis-empresas")] + router.urls
