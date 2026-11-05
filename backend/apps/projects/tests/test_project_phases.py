"""Fases, portado de Nexo (`test_project_phases.py`). Quien no ve el
proyecto recibe 404; un participante que no lo gestiona, 403."""

import pytest

from apps.projects.models import ProjectHistory, ProjectHistoryEvent, ProjectPhase

from .conftest import client_for, create_project

pytestmark = pytest.mark.django_db


def _create_phase(*, actor, project, **overrides) -> dict:
    payload = {"name": "Descubrimiento"}
    payload.update(overrides)
    response = client_for(actor).post(
        f"/api/v1/projects/{project.id}/phases/", payload, format="json"
    )
    assert response.status_code == 201, response.data
    return response.data


# --- Creación ----------------------------------------------------------------


def test_manager_creates_phase(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    assert phase["name"] == "Descubrimiento"
    assert phase["status"] == "PENDIENTE"
    assert phase["order"] == 0
    assert phase["registered_minutes"] == 0
    assert phase["participants"] == []
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.FASE_AGREGADA
    ).exists()


def test_phase_order_autoincrements(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _create_phase(actor=manager_level2, project=project, name="Fase 1")
    second = _create_phase(actor=manager_level2, project=project, name="Fase 2")
    assert second["order"] == 1


def test_non_manager_cannot_create_phase(manager_level2, assistant_level1, stranger):
    project = create_project(
        creator=manager_level2, responsible=assistant_level1, participant_ids=[stranger.id]
    )
    response = client_for(stranger).post(
        f"/api/v1/projects/{project.id}/phases/", {"name": "Fase"}, format="json"
    )
    assert response.status_code == 403


def test_empty_phase_name_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/phases/", {"name": "   "}, format="json"
    )
    assert response.status_code == 400


def test_project_detail_includes_phases(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _create_phase(actor=manager_level2, project=project)
    response = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    assert len(response.data["phases"]) == 1
    assert response.data["phases"][0]["name"] == "Descubrimiento"


# --- Edición ---------------------------------------------------------------------


def test_phase_status_change_logs_history(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/",
        {"status": "EN_PROGRESO"},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["status"] == "EN_PROGRESO"
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.FASE_ACTUALIZADA
    ).exists()


def test_phase_progress_edit_does_not_log_history(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/", {"progress": 50}, format="json"
    )
    assert response.status_code == 200
    assert response.data["progress"] == 50
    assert not ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.FASE_ACTUALIZADA
    ).exists()


def test_phase_progress_out_of_range_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/", {"progress": 150}, format="json"
    )
    assert response.status_code == 400


def test_non_manager_cannot_edit_phase(manager_level2, assistant_level1, stranger):
    project = create_project(
        creator=manager_level2, responsible=assistant_level1, participant_ids=[stranger.id]
    )
    phase = _create_phase(actor=manager_level2, project=project)
    response = client_for(stranger).patch(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/",
        {"name": "Otro nombre"},
        format="json",
    )
    assert response.status_code == 403


# --- Eliminación -------------------------------------------------------------------


def test_manager_deletes_phase(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    phase = _create_phase(actor=manager_level2, project=project)
    response = client_for(manager_level2).delete(
        f"/api/v1/projects/{project.id}/phases/{phase['id']}/"
    )
    assert response.status_code == 200
    assert not ProjectPhase.objects.filter(id=phase["id"]).exists()
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.FASE_ELIMINADA
    ).exists()


def test_non_manager_cannot_delete_phase(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    phase = _create_phase(actor=manager_level2, project=project)
    response = client_for(stranger).delete(f"/api/v1/projects/{project.id}/phases/{phase['id']}/")
    assert response.status_code == 404


def test_phase_404_for_wrong_project(manager_level2):
    project_a = create_project(creator=manager_level2, responsible=manager_level2)
    project_b = create_project(
        creator=manager_level2, responsible=manager_level2, name="Otro proyecto"
    )
    phase = _create_phase(actor=manager_level2, project=project_a)
    response = client_for(manager_level2).delete(
        f"/api/v1/projects/{project_b.id}/phases/{phase['id']}/"
    )
    assert response.status_code == 404
