from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import EmpresaViewSet, mis_empresas

router = DefaultRouter()
router.register("", EmpresaViewSet, basename="empresa")

# «mias» antes que el router: si no, `/empresas/mias/` entraría por la ruta de
# detalle del viewset y se resolvería como una empresa con id «mias».
urlpatterns = [path("mias/", mis_empresas, name="mis-empresas")] + router.urls
