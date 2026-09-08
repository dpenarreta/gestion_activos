from rest_framework.permissions import BasePermission

from apps.permissions.permissions import HasModulePermission


class IsSelf(BasePermission):
    """Permite la acción solo si el objeto pertenece al usuario autenticado."""

    def has_object_permission(self, request, view, obj):
        return obj == request.user


class UsuariosPermission(HasModulePermission):
    """Lectura: `usuarios.ver`. Escritura genérica: `usuarios.editar`
    (para las acciones que sí comparten ese permiso: editar datos, asignar
    roles/permisos, revocar sesiones)."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.editar"


class UsuariosCreatePermission(HasModulePermission):
    """Usada solo en la acción `create` del viewset de usuarios."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.crear"


class UsuariosDeshabilitarPermission(HasModulePermission):
    """Usada en `enable`/`disable`/`block`/`unblock`."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.deshabilitar"


class UsuariosRestablecerPasswordPermission(HasModulePermission):
    """Usada en la acción `reset_password` del viewset de usuarios."""

    view_permission = "usuarios.ver"
    write_permission = "usuarios.restablecer_password"
