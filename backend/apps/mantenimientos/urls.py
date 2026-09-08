from rest_framework.routers import DefaultRouter

from .views import CatalogoComponenteViewSet, MantenimientoViewSet

router = DefaultRouter()
router.register("componentes", CatalogoComponenteViewSet, basename="componentes")
router.register("", MantenimientoViewSet, basename="mantenimientos")

urlpatterns = router.urls
