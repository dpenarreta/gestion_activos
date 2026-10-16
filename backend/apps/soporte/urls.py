from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("tickets", views.TicketViewSet, basename="soporte-tickets")
router.register("horas", views.HorasViewSet, basename="soporte-horas")
router.register("config/niveles", views.NivelViewSet, basename="soporte-niveles")
router.register("config/categorias", views.CategoriaViewSet, basename="soporte-categorias")
router.register("config/casos", views.CasoViewSet, basename="soporte-casos")
router.register("config/tecnicos", views.TecnicoViewSet, basename="soporte-tecnicos")
router.register("config/formulario", views.CampoFormularioViewSet, basename="soporte-formulario")
router.register("config/sla", views.ReglaSLAViewSet, basename="soporte-sla")
router.register(
    "config/respuestas", views.RespuestaPredefinidaViewSet, basename="soporte-respuestas"
)

urlpatterns = [
    path("publico/<str:codigo>/", views.FormularioPublicoView.as_view(), name="soporte-formulario"),
    path("seguimiento/<str:token>/", views.SeguimientoView.as_view(), name="soporte-seguimiento"),
    path(
        "seguimiento/<str:token>/adjuntos/<int:adjunto_id>/",
        views.AdjuntoPublicoView.as_view(),
        name="soporte-seguimiento-adjunto",
    ),
    path("mi-horario/", views.MiAgendaView.as_view(), name="soporte-mi-horario"),
    path("reportes/", views.ReportesSoporteView.as_view(), name="soporte-reportes"),
] + router.urls
