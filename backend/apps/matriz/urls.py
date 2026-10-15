from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AreaViewSet,
    EntidadControlViewSet,
    catalogos,
    historial,
    mis_empresas,
    obligacion,
    obligaciones,
    periodo,
    periodos,
    personas,
    resumen,
)

router = DefaultRouter()
router.register("catalogos/areas", AreaViewSet, basename="matriz-areas")
router.register(
    "catalogos/entidades-control", EntidadControlViewSet, basename="matriz-entidades-control"
)

# «empresas/mias» va antes que el router por la misma razón que en empresas:
# así nunca la captura una ruta de detalle.
urlpatterns = [
    path("empresas/mias/", mis_empresas, name="matriz-mis-empresas"),
    # Todo lo que sigue trabaja sobre la empresa activa (cabecera X-Empresa),
    # como el resto del sistema: no lleva la empresa en la ruta.
    path("personas/", personas, name="matriz-personas"),
    path("catalogos/", catalogos, name="matriz-catalogos"),
    path("resumen/", resumen, name="matriz-resumen"),
    path("periodos/", periodos, name="matriz-periodos"),
    path("periodos/<int:pk>/", periodo, name="matriz-periodo"),
    path("periodos/<int:pk>/historial/", historial, name="matriz-periodo-historial"),
    path("obligaciones/", obligaciones, name="matriz-obligaciones"),
    path("obligaciones/<int:pk>/", obligacion, name="matriz-obligacion"),
] + router.urls
