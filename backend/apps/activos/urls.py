from rest_framework.routers import DefaultRouter

from .views import ActivoViewSet, TipoDispositivoViewSet

router = DefaultRouter()
router.register("tipos", TipoDispositivoViewSet, basename="tipos-dispositivo")
router.register("", ActivoViewSet, basename="activos")

urlpatterns = router.urls
