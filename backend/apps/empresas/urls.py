from django.urls import path

from .views import mis_empresas

urlpatterns = [path("mias/", mis_empresas, name="mis-empresas")]
