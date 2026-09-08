from rest_framework.permissions import SAFE_METHODS

from apps.permissions.permissions import HasActionPermission, HasModulePermission


class MantenimientosPermission(HasActionPermission):
    """Registrar una intervención y corregir/eliminar una ya registrada son
    permisos distintos: lo segundo altera el contador de RF-05 y, por su
    intermedio, la sugerencia de renovación de RF-07."""

    def get_required_permission(self, request, view) -> str:
        if request.method in SAFE_METHODS:
            return "mantenimientos.ver"
        if getattr(view, "action", None) == "create":
            return "mantenimientos.registrar"
        return "mantenimientos.editar"


class CatalogoComponentesPermission(HasModulePermission):
    view_permission = "mantenimientos.ver"
    write_permission = "mantenimientos.componentes"


class ExportacionMantenimientosPermission(HasActionPermission):
    """Mismo criterio que en activos: sacar la bitácora completa en un archivo
    es una acción distinta de consultarla en pantalla."""

    def get_required_permission(self, request, view) -> str:
        return "mantenimientos.exportar"
