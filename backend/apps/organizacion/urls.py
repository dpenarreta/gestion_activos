from rest_framework.routers import DefaultRouter

from .views import DepartamentoViewSet, EmpleadoViewSet, SedeViewSet

router = DefaultRouter()
router.register("departamentos", DepartamentoViewSet, basename="departamentos")
router.register("sedes", SedeViewSet, basename="sedes")
router.register("empleados", EmpleadoViewSet, basename="empleados")

urlpatterns = router.urls
