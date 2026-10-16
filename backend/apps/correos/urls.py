from django.urls import path

from .views import ListaDePlantillasView, PlantillaView, PruebaDePlantillaView, VistaPreviaView

urlpatterns = [
    path("", ListaDePlantillasView.as_view(), name="plantillas-correo"),
    path("<str:clave>/", PlantillaView.as_view(), name="plantilla-correo"),
    path(
        "<str:clave>/vista-previa/", VistaPreviaView.as_view(), name="plantilla-correo-vista-previa"
    ),
    path("<str:clave>/prueba/", PruebaDePlantillaView.as_view(), name="plantilla-correo-prueba"),
]
