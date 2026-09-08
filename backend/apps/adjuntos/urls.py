from rest_framework.routers import DefaultRouter

from .views import AdjuntoViewSet

router = DefaultRouter()
router.register("", AdjuntoViewSet, basename="adjuntos")

urlpatterns = router.urls
