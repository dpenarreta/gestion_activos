from apps.permissions.permissions import HasModulePermission


class AlertasPermission(HasModulePermission):
    view_permission = "alertas.ver"
    write_permission = "alertas.configurar"
