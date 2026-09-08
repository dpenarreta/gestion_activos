from apps.permissions.permissions import HasModulePermission


class OrganizacionPermission(HasModulePermission):
    view_permission = "organizacion.ver"
    write_permission = "organizacion.editar"
