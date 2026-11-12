from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CausaViewSet,
    LlamadoViewSet,
    MiosView,
    PersonasView,
    PropuestaView,
    VariablesView,
    VistaPreviaView,
)

router = DefaultRouter()
router.register("causas", CausaViewSet, basename="llamados-causas")
router.register("llamados", LlamadoViewSet, basename="llamados-llamados")

urlpatterns = [
    path("variables/", VariablesView.as_view(), name="llamados-variables"),
    path("vista-previa/", VistaPreviaView.as_view(), name="llamados-vista-previa"),
    path("propuesta/", PropuestaView.as_view(), name="llamados-propuesta"),
    path("personas/", PersonasView.as_view(), name="llamados-personas"),
    path("mios/", MiosView.as_view(), name="llamados-mios"),
] + router.urls
