"""Quién ve y quién gestiona cada proyecto (de Nexo, `projectAccess.ts`).

Nexo decidía con el nivel del rol (`ROLE_LEVEL`): el «liderazgo» (nivel >= 3:
el ADMINISTRADOR, el Jefe Nacional y el Coordinador Nacional) veía y
gestionaba todos los proyectos; el resto, solo los suyos. En la intranet ese
nivel no existe: como en Tareas (`apps.tasks.jerarquia`), lo que cada quien
ve sale del **organigrama** y lo que puede hacer, del **catálogo de permisos**
(`proyectos_gh.*`, asignados a los roles de Gestión Humana por
`projects/0002`):

- **Ver** un proyecto: quien administra el módulo (todos los de la empresa);
  su responsable, su creador o un participante; o el jefe (en el organigrama)
  de cualquiera de ellos. Ver no basta para escribir en él.
- **Gestionarlo** (editar, cambiar estado o responsable, fases y
  participantes): quien administra; su responsable o su creador; o quien
  tiene `proyectos_gh.supervisar` y el responsable o el creador es de su
  equipo (lo que en Nexo hacía el liderazgo, acotado ahora a su equipo).
- **Participar** (comentar, registrar actividades, subir documentos): quien
  lo gestiona o es participante.
- **Enviarlo a la papelera, restaurarlo o eliminarlo para siempre**: su
  creador o quien administra el módulo (`proyectos_gh.administrar`, el
  Administrador de Gestión Humana; decisión del usuario del 05/11/2026; en
  Nexo, solo el creador). Quien supervisa o gestiona sin haberlo creado, no.

Todo esto vale dentro de la empresa activa: el gestor de `Project` ya acota
las consultas a ella.
"""

from apps.permissions.authorization import user_has_permission
from apps.tasks import jerarquia

from .models import Project

ACCEDER = "proyectos_gh.acceder"
CREAR = "proyectos_gh.crear"
SUPERVISAR = "proyectos_gh.supervisar"
ADMINISTRAR = "proyectos_gh.administrar"

ALL_CODENAMES = (ACCEDER, CREAR, SUPERVISAR, ADMINISTRAR)


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def is_admin(user) -> bool:
    return can(user, ADMINISTRAR)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def can_create_project(user) -> bool:
    """`proyectos_gh.crear` (en Nexo, `proyectos.crear`)."""
    return can(user, CREAR)


def _participant_ids(project: Project, participant_user_ids=None) -> set[int]:
    if participant_user_ids is not None:
        return set(participant_user_ids)
    return set(project.participants.values_list("user_id", flat=True))


def _team_ids(user, team_ids=None) -> set[int]:
    return team_ids if team_ids is not None else jerarquia.equipo_ids(user)


def is_project_creator(user, project: Project) -> bool:
    """Más estricto que gestionar: solo quien lo creó."""
    return user.id == project.created_by_id


def can_delete_project(user, project: Project) -> bool:
    """Papelera, restaurar y eliminar para siempre: su creador o quien
    administra el módulo (decisión del 05/11/2026)."""
    return is_project_creator(user, project) or is_admin(user)


def is_project_manager(user, project: Project, *, team_ids=None) -> bool:
    if is_admin(user):
        return True
    if user.id in (project.responsible_id, project.created_by_id):
        return True
    if can(user, SUPERVISAR):
        equipo = _team_ids(user, team_ids)
        return project.responsible_id in equipo or project.created_by_id in equipo
    return False


def can_change_project_status(user, project: Project) -> bool:
    return is_project_manager(user, project)


def can_view_project(user, project: Project, participant_user_ids=None, *, team_ids=None) -> bool:
    if is_admin(user):
        return True
    participantes = _participant_ids(project, participant_user_ids)
    involucrados = {project.responsible_id, project.created_by_id} | participantes
    if user.id in involucrados:
        return True
    return bool(involucrados & _team_ids(user, team_ids))


def is_project_participant(user, project: Project, participant_user_ids=None) -> bool:
    """Puede comentar, registrar actividades y subir documentos."""
    if is_project_manager(user, project):
        return True
    return user.id in _participant_ids(project, participant_user_ids)
