from apps.permissions.permissions import HasModulePermission


class PoliticasPermission(HasModulePermission):
    view_permission = "politicas.ver"
    write_permission = "politicas.editar"
