from django.urls import path

from .catalogos_views import importar_catalogo, listar_catalogos, plantilla

urlpatterns = [
    path("", listar_catalogos, name="catalogos-masivos"),
    path("<str:clave>/plantilla/", plantilla, name="catalogo-plantilla"),
    path("<str:clave>/importar/", importar_catalogo, name="catalogo-importar"),
]
