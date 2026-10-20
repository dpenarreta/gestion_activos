from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AsignarView,
    DevolverIntentosView,
    MaterialViewSet,
    MiMaterialView,
    MiOnboardingView,
    ResultadosView,
)

router = DefaultRouter()
router.register("materiales", MaterialViewSet, basename="capacitacion-materiales")

urlpatterns = [
    path("mi-onboarding/", MiOnboardingView.as_view(), name="mi-onboarding"),
    path(
        "mi-onboarding/<int:pk>/<str:que>/", MiMaterialView.as_view(), name="mi-onboarding-material"
    ),
    path("resultados/", ResultadosView.as_view(), name="capacitacion-resultados"),
    path("asignar/", AsignarView.as_view(), name="capacitacion-asignar"),
    path("devolver-intentos/", DevolverIntentosView.as_view(), name="capacitacion-devolver"),
] + router.urls
