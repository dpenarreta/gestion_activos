from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AreaViewSet,
    EntidadControlViewSet,
    auditoria,
    calendario,
    cambiar_vencimiento,
    catalogos,
    configuracion_recordatorios,
    devolver,
    documento_archivo,
    documento_eliminar,
    documento_rechazar,
    documentos,
    documentos_resumen,
    enviar,
    ficha,
    historial,
    importar,
    mis_empresas,
    notificacion_reintentar,
    notificaciones,
    obligacion,
    obligaciones,
    periodo,
    periodos,
    personas,
    recordatorio_enviar,
    recordatorio_vista_previa,
    recordatorios_del_periodo,
    reportes,
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
    path("calendario/", calendario, name="matriz-calendario"),
    path("reportes/", reportes, name="matriz-reportes"),
    path("auditoria/", auditoria, name="matriz-auditoria"),
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
    path(
        "periodos/<int:pk>/recordatorios/",
        recordatorios_del_periodo,
        name="matriz-periodo-recordatorios",
    ),
    path(
        "periodos/<int:pk>/recordatorios/enviar/",
        recordatorio_enviar,
        name="matriz-periodo-recordatorio-enviar",
    ),
    path(
        "periodos/<int:pk>/recordatorios/vista-previa/",
        recordatorio_vista_previa,
        name="matriz-periodo-recordatorio-vista-previa",
    ),
    path(
        "recordatorios/configuracion/",
        configuracion_recordatorios,
        name="matriz-recordatorios-configuracion",
    ),
    path("notificaciones/", notificaciones, name="matriz-notificaciones"),
    path(
        "notificaciones/<int:pk>/reintentar/",
        notificacion_reintentar,
        name="matriz-notificacion-reintentar",
    ),
    path("obligaciones/", obligaciones, name="matriz-obligaciones"),
    path("obligaciones/<int:pk>/", obligacion, name="matriz-obligacion"),
    path("obligaciones/<int:pk>/ficha/", ficha, name="matriz-obligacion-ficha"),
    path("importar/", importar, name="matriz-importar"),
] + router.urls
