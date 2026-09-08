from rest_framework.routers import DefaultRouter

from .views import DepartamentoViewSet, EmpleadoViewSet

router = DefaultRouter()
router.register("departamentos", DepartamentoViewSet, basename="departamentos")
router.register("empleados", EmpleadoViewSet, basename="empleados")

urlpatterns = router.urls
