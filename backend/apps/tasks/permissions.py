"""Permisos DRF de Tareas y Equipo.

La entrada al módulo exige `tareas.acceder`; cada vista suma el permiso de su
acción. El ámbito fino (de quién es la tarea, si es de su equipo) lo revalida
cada servicio contra el registro concreto."""

from rest_framework.permissions import IsAuthenticated

from apps.permissions.permissions import HasModulePermission, Requiere

from . import access
from .models import Task
from .services import TaskService

CanAccessTasks = Requiere(access.ACCEDER)
CanRegularize = Requiere(access.REGULARIZAR)
CanCloseMonth = Requiere(access.CERRAR_MES)
CanAdministrar = Requiere(access.ADMINISTRAR)


class TeamPermission(HasModulePermission):
    """La pantalla de Equipo (de solo lectura)."""

    view_permission = access.EQUIPO_VER


class CanAccessTask(IsAuthenticated):
    """Ver, editar o comentar una tarea (ver `TaskService.can_access`)."""

    message = "No tiene acceso a esta tarea."

    def has_object_permission(self, request, view, obj: Task) -> bool:
        return TaskService.can_access(actor=request.user, task=obj)
