from rest_framework.routers import DefaultRouter

from .views import ActivoViewSet, TipoDispositivoViewSet
from .views_plantilla import ColumnaPlantillaViewSet

router = DefaultRouter()
router.register("tipos", TipoDispositivoViewSet, basename="tipos-dispositivo")
router.register(
    "columnas-plantilla", ColumnaPlantillaViewSet, basename="columnas-plantilla-activos"
)
router.register("", ActivoViewSet, basename="activos")

urlpatterns = router.urls
