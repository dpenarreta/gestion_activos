from rest_framework.routers import DefaultRouter

from .views import ReporteViewSet

router = DefaultRouter()
router.register("reportes", ReporteViewSet, basename="sugerencias-reportes")

urlpatterns = router.urls
