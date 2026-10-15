from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AreaViewSet,
    EntidadControlViewSet,
    cambiar_vencimiento,
    catalogos,
    devolver,
    documento_archivo,
    documento_eliminar,
    documento_rechazar,
    documentos,
    documentos_resumen,
    enviar,
    historial,
    mis_empresas,
    obligacion,
    obligaciones,
    periodo,
    periodos,
    personas,
    resumen,
    validar,
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
    path("periodos/<int:pk>/documentos/", documentos, name="matriz-periodo-documentos"),
    path("periodos/<int:pk>/enviar/", enviar, name="matriz-periodo-enviar"),
    path("periodos/<int:pk>/validar/", validar, name="matriz-periodo-validar"),
    path("periodos/<int:pk>/devolver/", devolver, name="matriz-periodo-devolver"),
    path(
        "periodos/<int:pk>/vencimiento/",
        cambiar_vencimiento,
        name="matriz-periodo-vencimiento",
    ),
    path("documentos/", documentos_resumen, name="matriz-documentos-resumen"),
    path("documentos/<int:pk>/archivo/", documento_archivo, name="matriz-documento-archivo"),
    path("documentos/<int:pk>/rechazar/", documento_rechazar, name="matriz-documento-rechazar"),
    path("documentos/<int:pk>/", documento_eliminar, name="matriz-documento-eliminar"),
    path("obligaciones/", obligaciones, name="matriz-obligaciones"),
    path("obligaciones/<int:pk>/", obligacion, name="matriz-obligacion"),
] + router.urls
