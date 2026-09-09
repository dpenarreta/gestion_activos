from django.urls import path

from .views import CatalogoReportesView, EjecutarReporteView

urlpatterns = [
    path("", CatalogoReportesView.as_view(), name="reportes-catalogo"),
    path("<slug:clave>/", EjecutarReporteView.as_view(), name="reportes-ejecutar"),
]
