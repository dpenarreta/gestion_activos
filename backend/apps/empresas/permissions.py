"""Quién administra las empresas y quién reparte el acceso a ellas.

Son dos permisos y no uno porque son dos decisiones distintas. Corregir el RUC
de una empresa es mantenimiento de una ficha; asignarle un usuario es **darle
acceso a todo su inventario**, y quien no tiene membresía no ve nada de ella.
Juntarlos obligaría a dar lo segundo para permitir lo primero.
"""

from apps.permissions.permissions import HasModulePermission


class EmpresasPermission(HasModulePermission):
    """Lectura y mantenimiento de la ficha de la empresa."""

    view_permission = "empresas.ver"
    write_permission = "empresas.editar"


class EmpresasAsignarPermission(HasModulePermission):
    """Reparto de acceso: en qué empresas trabaja cada cuenta."""

    view_permission = "empresas.ver"
    write_permission = "empresas.asignar"
