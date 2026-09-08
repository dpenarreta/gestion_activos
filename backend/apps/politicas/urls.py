from rest_framework.routers import DefaultRouter

from .views import PoliticaObsolescenciaViewSet

router = DefaultRouter()
router.register("", PoliticaObsolescenciaViewSet, basename="politicas")

urlpatterns = router.urls
