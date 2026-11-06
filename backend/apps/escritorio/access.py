"""Quién entra al Escritorio y a quién se le puede dejar una nota.

En Nexo había un permiso, `escritorio_digital.usar` (los diez roles del
departamento; nunca el ADMINISTRADOR, por diseño). Aquí es
`escritorio.acceder`, con el mismo reparto más el Administrador de Gestión
Humana y el Superusuario (`escritorio/0002`). No hay un permiso para
administrar: las notas y los recordatorios son personales y nadie, ni quien
administra el módulo, ve los de otra persona (como en Nexo).

- Una nota la ven solo su remitente y su destinatario. Leerla, fijarla y
  archivarla es del destinatario (es su escritorio); responder, de los dos.
- Un recordatorio lo ve y lo toca solo su dueño.
- A quién se le deja una nota: en Nexo, a cualquier cuenta que no fuera
  ADMINISTRADOR. Aquí, a las personas activas de la empresa activa con
  `escritorio.acceder` (`destinatarios`): una nota a quien no puede abrir su
  escritorio no le llegaría nunca. Las cuentas de TI con `is_superuser` y sin
  el permiso por un rol quedan fuera, como el ADMINISTRADOR de Nexo.

Convertir un recordatorio en tarea pide además `tareas.acceder`: la tarea es
del módulo Tareas y su responsable tiene que poder abrirla.
"""

from django.contrib.auth import get_user_model

from apps.permissions.authorization import user_has_permission
from apps.tasks import access as tareas_access
from apps.tasks.roles import in_active_company

ACCEDER = "escritorio.acceder"

ALL_CODENAMES = (ACCEDER,)


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def puede_convertir_en_tarea(user) -> bool:
    return tareas_access.can(user, tareas_access.ACCEDER)


def destinatarios(actor):
    """Las personas a quienes `actor` puede dejar una nota en la empresa
    activa: activas, de la empresa, con `escritorio.acceder` (por rol global,
    de su membresía o directo) y que no sean él."""
    from apps.novedades.access import permission_filter

    User = get_user_model()
    con_permiso = User.objects.filter(permission_filter(ACCEDER)).values("pk")
    return (
        User.objects.filter(is_active=True)
        .filter(in_active_company())
        .filter(pk__in=con_permiso)
        .exclude(pk=actor.pk)
        .order_by("first_name", "last_name", "username")
    )
