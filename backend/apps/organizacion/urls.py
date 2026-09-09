from rest_framework.routers import DefaultRouter

from .views import DepartamentoViewSet, EmpleadoViewSet, UbicacionViewSet

router = DefaultRouter()
router.register("departamentos", DepartamentoViewSet, basename="departamentos")
router.register("ubicaciones", UbicacionViewSet, basename="ubicaciones")
router.register("empleados", EmpleadoViewSet, basename="empleados")

urlpatterns = router.urls
