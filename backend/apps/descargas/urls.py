from django.urls import path

from .views import CopiaView, DescargasView, ExportarView, ModulosView

urlpatterns = [
    path("", DescargasView.as_view(), name="descargas"),
    path("modulos/", ModulosView.as_view(), name="descargas-modulos"),
    path("exportar/", ExportarView.as_view(), name="descargas-exportar"),
    path("<int:pk>/copia/", CopiaView.as_view(), name="descargas-copia"),
]
