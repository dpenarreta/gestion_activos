from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AceptacionesConfidencialidadView,
    AceptarConfidencialidadView,
    AjustesCarruselView,
    AsignacionesView,
    AvisoInicioView,
    TextosLegalesView,
    CalendarioView,
    CargaPersonasView,
    CargoViewSet,
    ConcesionarioViewSet,
    ConfidencialidadView,
    DepartamentoViewSet,
    DocumentoInstitucionalViewSet,
    EmpleadoViewSet,
    EventoCalendarioViewSet,
    ExportarOrganigramaView,
    HerramientaViewSet,
    ImagenAvisoInicioView,
    MiAniversarioView,
    MiCumpleanosView,
    MisDatosView,
    MisHerramientasView,
    MisVacacionesView,
    NivelJerarquicoViewSet,
    NoticiaInicioViewSet,
    OrganigramaView,
    PerfilCargoView,
    PlantillaPersonasView,
    ProveedorViewSet,
    SedeViewSet,
    UnidadOrganizacionalViewSet,
    UsoHerramientasView,
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
router.register("herramientas", HerramientaViewSet, basename="herramientas")
router.register("documentos", DocumentoInstitucionalViewSet, basename="documentos")
router.register("noticias", NoticiaInicioViewSet, basename="noticias")
router.register("eventos", EventoCalendarioViewSet, basename="eventos")

urlpatterns = [
    path("mis-datos/", MisDatosView.as_view(), name="mis-datos"),
    path("mis-datos/cumpleanos/", MiCumpleanosView.as_view(), name="mi-cumpleanos"),
    path("mis-datos/aniversario/", MiAniversarioView.as_view(), name="mi-aniversario"),
    path("organigrama/", OrganigramaView.as_view(), name="organigrama"),
    path("asignaciones/", AsignacionesView.as_view(), name="asignaciones"),
    path(
        "carga-personas/plantilla/",
        PlantillaPersonasView.as_view(),
        name="carga-personas-plantilla",
    ),
    path("carga-personas/", CargaPersonasView.as_view(), name="carga-personas"),
    path("cargos/<int:pk>/perfil/", PerfilCargoView.as_view(), name="cargo-perfil"),
    path("mis-datos/herramientas/", MisHerramientasView.as_view(), name="mis-herramientas"),
    path("herramientas-uso/", UsoHerramientasView.as_view(), name="herramientas-uso"),
    path("organigrama/exportar/", ExportarOrganigramaView.as_view(), name="organigrama-exportar"),
    path("confidencialidad/", ConfidencialidadView.as_view(), name="confidencialidad"),
    path("carrusel/", AjustesCarruselView.as_view(), name="carrusel"),
    path("calendario/", CalendarioView.as_view(), name="calendario"),
    path("vacaciones/mias/", MisVacacionesView.as_view(), name="mis-vacaciones"),
    path("vacaciones/", VacacionesDeTodosView.as_view(), name="vacaciones"),
    path("aviso-inicio/", AvisoInicioView.as_view(), name="aviso-inicio"),
    path("textos-legales/", TextosLegalesView.as_view(), name="textos-legales"),
    path("textos-legales/<str:clave>/", TextosLegalesView.as_view(), name="texto-legal"),
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
