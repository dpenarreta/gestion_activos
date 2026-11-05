"""Participantes, comentarios e historial, portado de Nexo
(`test_project_collaboration.py`). Quien no ve el proyecto recibe 404 (en
Nexo, 403); quien lo ve sin poder actuar, 403."""

import pytest

from apps.projects.models import ProjectHistory, ProjectHistoryEvent, ProjectParticipant

from .conftest import client_for, create_project

pytestmark = pytest.mark.django_db


# --- Comentarios ---------------------------------------------------------------


def test_participant_can_post_comment(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    response = client_for(assistant_level1).post(
        f"/api/v1/projects/{project.id}/comments/", {"text": "Avanzando bien"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["text"] == "Avanzando bien"
    assert response.data["author"]["id"] == assistant_level1.id


def test_non_participant_cannot_post_comment(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).post(
        f"/api/v1/projects/{project.id}/comments/", {"text": "Hola"}, format="json"
    )
    assert response.status_code == 404


def test_empty_comment_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/comments/", {"text": "   "}, format="json"
    )
    assert response.status_code == 400


def test_comment_does_not_log_history(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/comments/", {"text": "Nota"}, format="json"
    )
    assert not ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.COMENTARIO_AGREGADO
    ).exists()


def test_list_comments_ordered_chronologically(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client = client_for(manager_level2)
    client.post(f"/api/v1/projects/{project.id}/comments/", {"text": "Primero"}, format="json")
    client.post(f"/api/v1/projects/{project.id}/comments/", {"text": "Segundo"}, format="json")
    response = client.get(f"/api/v1/projects/{project.id}/comments/")
    assert [c["text"] for c in response.data] == ["Primero", "Segundo"]


# --- Participantes: alta ----------------------------------------------------------


def test_manager_adds_participant(manager_level2, assistant_level1):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": assistant_level1.id}, format="json"
    )
    assert response.status_code == 201
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).exists()
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO
    ).exists()


def test_non_manager_cannot_add_participant(manager_level2, assistant_level1, stranger):
    """Un participante ve el proyecto pero no agrega a otros: 403."""
    project = create_project(
        creator=manager_level2, responsible=assistant_level1, participant_ids=[stranger.id]
    )
    response = client_for(stranger).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": manager_level2.id}, format="json"
    )
    assert response.status_code == 403


def test_adding_existing_participant_returns_409(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": assistant_level1.id}, format="json"
    )
    assert response.status_code == 409
    assert response.data["error"]["code"] == "conflict"


def test_adding_participant_with_invalid_user_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/participants/", {"user": 999999}, format="json"
    )
    assert response.status_code == 400


# --- Participantes: baja ------------------------------------------------------------


def test_manager_removes_participant(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    participant = ProjectParticipant.objects.get(project=project, user=assistant_level1)
    response = client_for(manager_level2).delete(
        f"/api/v1/projects/{project.id}/participants/{participant.id}/"
    )
    assert response.status_code == 200
    assert not ProjectParticipant.objects.filter(id=participant.id).exists()
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.PARTICIPANTE_ELIMINADO
    ).exists()


def test_non_manager_cannot_remove_participant(manager_level2, assistant_level1, stranger):
    project = create_project(
        creator=manager_level2,
        responsible=manager_level2,
        participant_ids=[assistant_level1.id, stranger.id],
    )
    participant = ProjectParticipant.objects.get(project=project, user=assistant_level1)
    response = client_for(stranger).delete(
        f"/api/v1/projects/{project.id}/participants/{participant.id}/"
    )
    assert response.status_code == 403


def test_cannot_remove_responsible_as_participant(manager_level2, assistant_level1):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"responsible": assistant_level1.id}, format="json"
    )
    participant = ProjectParticipant.objects.get(project=project, user=assistant_level1)
    response = client_for(manager_level2).delete(
        f"/api/v1/projects/{project.id}/participants/{participant.id}/"
    )
    assert response.status_code == 409


def test_remove_participant_404_for_wrong_project(manager_level2, assistant_level1):
    project_a = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    project_b = create_project(
        creator=manager_level2, responsible=manager_level2, name="Otro proyecto"
    )
    participant = ProjectParticipant.objects.get(project=project_a, user=assistant_level1)
    response = client_for(manager_level2).delete(
        f"/api/v1/projects/{project_b.id}/participants/{participant.id}/"
    )
    assert response.status_code == 404


# --- Historial --------------------------------------------------------------------


def test_history_visible_to_manager(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/history/")
    assert response.status_code == 200
    assert response.data[0]["event"] == ProjectHistoryEvent.CREADO


def test_history_hidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).get(f"/api/v1/projects/{project.id}/history/")
    assert response.status_code == 404


def test_history_ordered_most_recent_first(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"status": "EN_EJECUCION"}, format="json"
    )
    response = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/history/")
    assert response.data[0]["event"] == ProjectHistoryEvent.ESTADO_CAMBIADO
    assert response.data[-1]["event"] == ProjectHistoryEvent.CREADO
