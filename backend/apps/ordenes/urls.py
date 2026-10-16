from rest_framework.routers import DefaultRouter

from .views import OrdenViewSet

router = DefaultRouter()
router.register("", OrdenViewSet, basename="ordenes")

urlpatterns = router.urls
