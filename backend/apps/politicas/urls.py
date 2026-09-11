from rest_framework.routers import DefaultRouter

from .views import PoliticaDepreciacionViewSet, PoliticaObsolescenciaViewSet

router = DefaultRouter()
# La de depreciación va primero: registrada después, la ruta vacía de
# obsolescencia se quedaría con «depreciacion» como si fuera el id de una
# política.
router.register("depreciacion", PoliticaDepreciacionViewSet, basename="politicas-depreciacion")
router.register("", PoliticaObsolescenciaViewSet, basename="politicas")

urlpatterns = router.urls
