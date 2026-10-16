from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("", views.NotificacionViewSet, basename="notificaciones")

urlpatterns = router.urls
