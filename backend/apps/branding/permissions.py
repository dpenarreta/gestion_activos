from apps.permissions.permissions import HasModulePermission


class ConfiguracionPermission(HasModulePermission):
    view_permission = "configuracion.ver"
    write_permission = "configuracion.editar"
