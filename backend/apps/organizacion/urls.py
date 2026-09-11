from rest_framework.routers import DefaultRouter

from .views import (
    ConcesionarioViewSet,
    DepartamentoViewSet,
    EmpleadoViewSet,
    ProveedorViewSet,
    SedeViewSet,
)

router = DefaultRouter()
router.register("departamentos", DepartamentoViewSet, basename="departamentos")
router.register("sedes", SedeViewSet, basename="sedes")
router.register("empleados", EmpleadoViewSet, basename="empleados")
router.register("proveedores", ProveedorViewSet, basename="proveedores")
router.register("concesionarios", ConcesionarioViewSet, basename="concesionarios")

urlpatterns = router.urls
