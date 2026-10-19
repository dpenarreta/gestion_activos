from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AceptacionesConfidencialidadView,
    AceptarConfidencialidadView,
    AjustesCarruselView,
    AsignacionesView,
    AvisoInicioView,
    CalendarioView,
    CargoViewSet,
    ConcesionarioViewSet,
    ConfidencialidadView,
    DocumentoInstitucionalViewSet,
    EventoCalendarioViewSet,
    ImagenAvisoInicioView,
    DepartamentoViewSet,
    EmpleadoViewSet,
    MisDatosView,
    MisVacacionesView,
    NivelJerarquicoViewSet,
    NoticiaInicioViewSet,
    OrganigramaView,
    ProveedorViewSet,
    SedeViewSet,
    UnidadOrganizacionalViewSet,
    VacacionesDeTodosView,
)

router = DefaultRouter()
router.register("departamentos", DepartamentoViewSet, basename="departamentos")
router.register("sedes", SedeViewSet, basename="sedes")
router.register("empleados", EmpleadoViewSet, basename="empleados")
router.register("proveedores", ProveedorViewSet, basename="proveedores")
router.register("concesionarios", ConcesionarioViewSet, basename="concesionarios")
# Organigrama (módulo Institucional).
router.register("niveles", NivelJerarquicoViewSet, basename="niveles")
router.register("unidades", UnidadOrganizacionalViewSet, basename="unidades")
router.register("cargos", CargoViewSet, basename="cargos")
router.register("documentos", DocumentoInstitucionalViewSet, basename="documentos")
router.register("noticias", NoticiaInicioViewSet, basename="noticias")
router.register("eventos", EventoCalendarioViewSet, basename="eventos")

urlpatterns = [
    path("mis-datos/", MisDatosView.as_view(), name="mis-datos"),
    path("organigrama/", OrganigramaView.as_view(), name="organigrama"),
    path("asignaciones/", AsignacionesView.as_view(), name="asignaciones"),
    path("confidencialidad/", ConfidencialidadView.as_view(), name="confidencialidad"),
    path("carrusel/", AjustesCarruselView.as_view(), name="carrusel"),
    path("calendario/", CalendarioView.as_view(), name="calendario"),
    path("vacaciones/mias/", MisVacacionesView.as_view(), name="mis-vacaciones"),
    path("vacaciones/", VacacionesDeTodosView.as_view(), name="vacaciones"),
    path("aviso-inicio/", AvisoInicioView.as_view(), name="aviso-inicio"),
    path("aviso-inicio/imagen/", ImagenAvisoInicioView.as_view(), name="aviso-inicio-imagen"),
    path(
        "confidencialidad/aceptar/",
        AceptarConfidencialidadView.as_view(),
        name="confidencialidad-aceptar",
    ),
    path(
        "confidencialidad/aceptaciones/",
        AceptacionesConfidencialidadView.as_view(),
        name="confidencialidad-aceptaciones",
    ),
] + router.urls
