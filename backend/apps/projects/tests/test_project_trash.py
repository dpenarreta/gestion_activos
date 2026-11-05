"""La papelera de Proyectos, portado de Nexo (`test_project_trash.py`).

Adaptaciones: quien ve toda la papelera es el Administrador de Gestión
Humana (en Nexo, el liderazgo); quien supervisa ve la de su equipo; un
proyecto que la persona no ve responde 404 también al restaurarlo.

Decisión del usuario del 05/11/2026: el Administrador de Gestión Humana
(`proyectos_gh.administrar`) también envía a la papelera, restaura y elimina
para siempre cualquier proyecto de la empresa, no solo su creador. Quien
supervisa (ve el proyecto por su equipo) sigue sin poder."""

import pytest

from apps.core.models import AuditLog
from apps.projects.models import Project, ProjectHistory, ProjectHistoryEvent, RecoveryItem

from .conftest import client_for, create_project, make_user, organigrama

pytestmark = pytest.mark.django_db


def _trash_project(project, creator) -> None:
    response = client_for(creator).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200, response.data


# --- GET /projects/trash/ --------------------------------------------------------


def test_trash_requires_can_create_project(assistant_level1):
    response = client_for(assistant_level1).get("/api/v1/projects/trash/")
    assert response.status_code == 403


def test_trash_lists_only_own_projects_for_non_leadership(manager_level2):
    other_creator = make_user("other_mgr", "ANALISTA_CC")
    own = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(own, manager_level2)
    other = create_project(creator=other_creator, responsible=other_creator)
    _trash_project(other, other_creator)

    response = client_for(manager_level2).get("/api/v1/projects/trash/")
    assert response.status_code == 200
    assert [p["id"] for p in response.data] == [own.id]


def test_trash_admin_sees_everyone_and_can_delete_any(admin_gh, manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)

    response = client_for(admin_gh).get("/api/v1/projects/trash/")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["can_delete"] is True

    response_owner = client_for(manager_level2).get("/api/v1/projects/trash/")
    assert response_owner.data[0]["can_delete"] is True


def test_trash_supervisor_sees_his_team(leadership, manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    assert client_for(leadership).get("/api/v1/projects/trash/").data == []

    organigrama(leadership, manager_level2)
    response = client_for(leadership).get("/api/v1/projects/trash/")
    assert [p["id"] for p in response.data] == [project.id]
    assert response.data[0]["can_delete"] is False


def test_trash_includes_retention_fields(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)

    entry = client_for(manager_level2).get("/api/v1/projects/trash/").data[0]
    assert entry["expires_at"] is not None
    assert entry["ms_remaining"] > 0
    assert entry["responsible"]["id"] == manager_level2.id
    assert entry["created_by"]["id"] == manager_level2.id


def test_trash_purges_expired_items_lazily(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    item = RecoveryItem.objects.get(entity_type="PROJECT", entity_id=str(project.id))
    item.expires_at = item.deleted_at
    item.save(update_fields=["expires_at"])

    response = client_for(manager_level2).get("/api/v1/projects/trash/")
    assert response.status_code == 200
    assert response.data == []
    assert not Project.objects.filter(pk=project.id).exists()
    assert AuditLog.objects.filter(action="proyectos_gh.papelera.purge_expired").exists()


# --- POST /projects/<id>/restore/ ---------------------------------------------------


def test_restore_404_for_missing_project(manager_level2):
    response = client_for(manager_level2).post("/api/v1/projects/999999/restore/")
    assert response.status_code == 404


def test_restore_409_when_not_in_trash(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 409


def test_restore_403_for_non_creator_supervisor(leadership, manager_level2):
    """Quien supervisa ve el proyecto de su equipo, pero no lo restaura."""
    organigrama(leadership, manager_level2)
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    response = client_for(leadership).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"


def test_restore_succeeds_for_admin_gh(admin_gh, manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    response = client_for(admin_gh).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.deleted_at is None
    assert AuditLog.objects.filter(
        action="proyectos_gh.papelera.restore", target_id=str(project.id)
    ).exists()


def test_restore_404_for_who_does_not_see_it(manager_level2, stranger):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    response = client_for(stranger).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 404


def test_restore_succeeds_for_creator(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)

    response = client_for(manager_level2).post(f"/api/v1/projects/{project.id}/restore/")
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.deleted_at is None
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.RESTAURADO
    ).exists()


# --- DELETE /projects/<id>/permanent/ ------------------------------------------------


def test_permanent_404_for_missing_project(manager_level2):
    response = client_for(manager_level2).delete("/api/v1/projects/999999/permanent/")
    assert response.status_code == 404


def test_permanent_409_when_not_in_trash(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/permanent/")
    assert response.status_code == 409


def test_permanent_403_for_non_creator_supervisor(leadership, manager_level2):
    organigrama(leadership, manager_level2)
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _trash_project(project, manager_level2)
    response = client_for(leadership).delete(f"/api/v1/projects/{project.id}/permanent/")
    assert response.status_code == 403
    assert Project.objects.filter(pk=project.id).exists()


def test_permanent_hard_deletes_for_admin_gh(admin_gh, manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    project_id = project.id
    _trash_project(project, manager_level2)
    response = client_for(admin_gh).delete(f"/api/v1/projects/{project_id}/permanent/")
    assert response.status_code == 200
    assert not Project.objects.filter(pk=project_id).exists()


# --- DELETE /projects/<id>/ (a la papelera) ------------------------------------------


def test_admin_gh_moves_any_project_to_trash(admin_gh, manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    detalle = client_for(admin_gh).get(f"/api/v1/projects/{project.id}/")
    assert detalle.data["can_delete"] is True
    _trash_project(project, admin_gh)
    project.refresh_from_db()
    assert project.deleted_at is not None


def test_supervisor_cannot_move_team_project_to_trash(leadership, manager_level2):
    organigrama(leadership, manager_level2)
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(leadership).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 403
    project.refresh_from_db()
    assert project.deleted_at is None

