"""Autorización de Tareas y Equipo.

Dos ejes, los dos resueltos en el servidor en cada petición:

1. **Permisos del catálogo** (`tareas.*`, `equipo.*`), asignados a los roles
   de Gestión Humana por la migración `tasks/0002`. Son los de Nexo más los
   que reemplazan lo que allá dependía de ser superusuario o de
   `usuarios.editar` (que en la intranet es un permiso de TI):

   - `tareas.acceder`: entrar al módulo (en Nexo, toda cuenta).
   - `tareas.validar`: validar el Tiempo Objetivo y decidir la Fecha Fin de
     tareas ajenas (en Nexo, `usuarios.editar`).
   - `tareas.regularizar` y `tareas.cerrar_mes`: los mismos de Nexo.
   - `tareas.administrar`: lo que en Nexo era del ADMINISTRADOR (superusuario):
     corregir archivadas, editar horas registradas, el catálogo de motivos,
     los ajustes, y ver y gestionar cualquier tarea de la empresa.
   - `equipo.ver`: la pantalla de Equipo.

2. **Ámbito de datos**, que no es un permiso: el organigrama
   (`jerarquia.py`). Cada quien ve sus tareas, las que creó y las de su
   equipo; asigna a sí mismo o a su equipo.
"""

from apps.permissions.authorization import user_has_permission

ACCEDER = "tareas.acceder"
VALIDAR = "tareas.validar"
REGULARIZAR = "tareas.regularizar"
CERRAR_MES = "tareas.cerrar_mes"
ADMINISTRAR = "tareas.administrar"
EQUIPO_VER = "equipo.ver"

ALL_CODENAMES = (ACCEDER, VALIDAR, REGULARIZAR, CERRAR_MES, ADMINISTRAR, EQUIPO_VER)


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def is_admin(user) -> bool:
    """Administra el módulo: el superusuario o quien tiene `tareas.administrar`."""
    return can(user, ADMINISTRAR)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]
