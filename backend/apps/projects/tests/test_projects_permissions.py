"""Reglas de acceso de Proyectos (`permissions.py`), portadas de Nexo
(`test_projects_permissions.py`).

Lo que cambia: en Nexo «liderazgo» era el nivel del rol (>= 3) y veía y
gestionaba todo. Aquí gestiona quien tiene `proyectos_gh.supervisar` y solo
los proyectos de su equipo en el organigrama; ve y gestiona todo quien tiene
`proyectos_gh.administrar`. Las pruebas de `role_level`/`is_leadership` de
Nexo quedan fuera: ese nivel no existe en la intranet."""

import pytest

from apps.projects.models import Project
from apps.projects.permissions import (
    can_create_project,
    can_view_project,
    is_project_creator,
    is_project_manager,
    is_project_participant,
)
from apps.users.models import User

from .conftest import make_admin, make_user, organigrama

pytestmark = pytest.mark.django_db


def _fresh(user: User) -> User:
    return User.objects.get(pk=user.pk)


def _project(responsible: User, created_by: User) -> Project:
    return Project(
        name="Proyecto",
        priority="ALTA",
        start_date="2026-08-01T00:00:00Z",
        target_date="2026-09-01T00:00:00Z",
        target_time_hours=10,
        responsible=responsible,
        created_by=created_by,
    )


# --- can_create_project ------------------------------------------------------


def test_can_create_project_by_permission():
    assert can_create_project(_fresh(make_user("analista", "ANALISTA_CC"))) is True
    assert can_create_project(_fresh(make_user("asistente", "ASISTENTE_GH"))) is False


# --- is_project_manager --------------------------------------------------------


def test_admin_manages_any_project():
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    assert is_project_manager(_fresh(make_admin()), _project(responsible, creator)) is True


def test_supervisor_manages_only_projects_of_his_team():
    leader = make_user("coord", "COORDINADOR_NACIONAL")
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_manager(_fresh(leader), project) is False

    organigrama(leader, responsible)
    assert is_project_manager(_fresh(leader), project) is True


def test_boss_without_supervisar_does_not_manage():
    jefe = make_user("coord_zs", "COORDINADOR_ZS")
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    organigrama(jefe, responsible)
    assert is_project_manager(_fresh(jefe), _project(responsible, creator)) is False


def test_is_project_manager_true_for_responsible_or_creator():
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_manager(_fresh(responsible), project) is True
    assert is_project_manager(_fresh(creator), project) is True


def test_is_project_manager_false_for_unrelated_non_leadership():
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    stranger = make_user("stranger", "ASISTENTE_SELECCION")
    assert is_project_manager(_fresh(stranger), _project(responsible, creator)) is False


# --- is_project_creator (más estricto que gestionar) ---------------------------


def test_is_project_creator_false_for_responsible_leadership_and_admin():
    leader = make_user("coord", "COORDINADOR_NACIONAL")
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_creator(responsible, project) is False
    assert is_project_creator(leader, project) is False
    assert is_project_creator(make_admin(), project) is False
    assert is_project_creator(creator, project) is True


# --- can_view_project / is_project_participant ---------------------------------


def test_can_view_project_true_for_participant():
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    participant = make_user("part", "ASISTENTE_SELECCION")
    project = _project(responsible, creator)
    assert can_view_project(_fresh(participant), project, [participant.id]) is True


def test_can_view_project_false_for_non_participant_non_manager():
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    stranger = make_user("stranger", "ASISTENTE_SELECCION")
    assert can_view_project(_fresh(stranger), _project(responsible, creator), []) is False


def test_boss_in_the_org_chart_sees_projects_of_his_team():
    """Lo nuevo: el jefe ve los proyectos de su equipo aunque no participe."""
    jefe = make_user("coord_zs", "COORDINADOR_ZS")
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    participant = make_user("part", "ASISTENTE_SELECCION")
    project = _project(responsible, creator)
    assert can_view_project(_fresh(jefe), project, [participant.id]) is False

    organigrama(jefe, participant)
    assert can_view_project(_fresh(jefe), project, [participant.id]) is True
    # Ver no es participar.
    assert is_project_participant(_fresh(jefe), project, [participant.id]) is False


def test_is_project_participant_true_for_manager_without_participant_row():
    responsible = make_user("resp", "ASISTENTE_GH")
    creator = make_user("creator", "ASISTENTE_GH")
    project = _project(responsible, creator)
    assert is_project_participant(_fresh(responsible), project, []) is True
