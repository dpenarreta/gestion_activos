from rest_framework.routers import DefaultRouter

from .views import SolicitudViewSet

router = DefaultRouter()
router.register("", SolicitudViewSet, basename="solicitudes")

urlpatterns = router.urls
