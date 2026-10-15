from apps.permissions.permissions import HasModulePermission


class CatalogosPermission(HasModulePermission):
    """Áreas y entidades de control: permisos del sistema, globales (§6.2)."""

    view_permission = "catalogos.ver"
    write_permission = "catalogos.editar"
