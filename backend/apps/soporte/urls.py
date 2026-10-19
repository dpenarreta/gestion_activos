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
    # Quien pide soporte, con sesión (no hay formulario público desde el 20/10/2026).
    path("solicitar/", views.SolicitarView.as_view(), name="soporte-solicitar"),
    path("mis-tickets/", views.MisTicketsView.as_view(), name="soporte-mis-tickets"),
    path("mis-tickets/<int:pk>/", views.MiTicketView.as_view(), name="soporte-mi-ticket"),
    path(
        "mis-tickets/<int:pk>/encuesta/",
        views.MiEncuestaView.as_view(),
        name="soporte-mi-encuesta",
    ),
    path(
        "mis-tickets/<int:pk>/adjuntos/<int:adjunto_id>/",
        views.MiAdjuntoView.as_view(),
        name="soporte-mi-adjunto",
    ),
    path("etiquetas/", views.EtiquetasView.as_view(), name="soporte-etiquetas"),
    path("aprobaciones/", views.AprobacionesView.as_view(), name="soporte-aprobaciones"),
    path(
        "aprobaciones/<int:pk>/decidir/",
        views.DecidirAprobacionView.as_view(),
        name="soporte-aprobacion-decidir",
    ),
    path("config/mesa/", views.MesaView.as_view(), name="soporte-mesa"),
    path("mi-horario/", views.MiAgendaView.as_view(), name="soporte-mi-horario"),
    path("reportes/", views.ReportesSoporteView.as_view(), name="soporte-reportes"),
] + router.urls
