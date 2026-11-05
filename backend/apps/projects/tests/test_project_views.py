"""CRUD de `/api/v1/projects/`, portado de Nexo (`test_project_views.py`).

Adaptaciones: un proyecto que la persona no ve responde 404 (Nexo, 403); el
«liderazgo» que veía todo es ahora el Administrador de Gestión Humana; los
documentos se suben como PDF real (se valida la firma)."""

from unittest.mock import ANY

import pytest

from apps.projects.models import Project, ProjectHistory, ProjectHistoryEvent, ProjectParticipant

from .conftest import PDF_B64, client_for, create_project, project_payload

pytestmark = pytest.mark.django_db


# --- Creación ----------------------------------------------------------------


def test_level2_user_creates_project(manager_level2):
    response = client_for(manager_level2).post(
        "/api/v1/projects/", project_payload(manager_level2), format="json"
    )
    assert response.status_code == 201
    project = Project.objects.get(name="Rediseño de onboarding")
    assert project.created_by_id == manager_level2.id
    assert project.status == Project.Status.PENDIENTE


def test_level1_user_cannot_create_project(assistant_level1):
    response = client_for(assistant_level1).post(
        "/api/v1/projects/", project_payload(assistant_level1), format="json"
    )
    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"


def test_create_missing_required_fields_returns_400(manager_level2):
    response = client_for(manager_level2).post(
        "/api/v1/projects/", {"name": "Sin responsable"}, format="json"
    )
    assert response.status_code == 400
    assert "responsible" in response.data["error"]["details"]


def test_create_logs_creado_history(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    entry = ProjectHistory.objects.get(project=project)
    assert entry.event == ProjectHistoryEvent.CREADO
    assert entry.actor_id == manager_level2.id


def test_create_does_not_auto_add_responsible_or_creator_as_participant(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    assert ProjectParticipant.objects.filter(project=project).count() == 0


def test_create_adds_explicit_participants(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).exists()


# --- Listado (visibilidad) ------------------------------------------------------


def test_admin_sees_all_projects(admin_gh, manager_level2, assistant_level1):
    """En Nexo, el liderazgo; aquí, quien administra el módulo."""
    create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(admin_gh).get("/api/v1/projects/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_leadership_without_org_chart_does_not_see_all(
    leadership, manager_level2, assistant_level1
):
    create_project(creator=manager_level2, responsible=assistant_level1)
    assert client_for(leadership).get("/api/v1/projects/").data == []


def test_non_leadership_only_sees_own_projects(manager_level2, assistant_level1, stranger):
    create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).get("/api/v1/projects/")
    assert response.status_code == 200
    assert response.data == []


def test_non_leadership_sees_project_as_participant(manager_level2, assistant_level1, stranger):
    project = create_project(
        creator=manager_level2, responsible=assistant_level1, participant_ids=[stranger.id]
    )
    response = client_for(stranger).get("/api/v1/projects/")
    assert [p["id"] for p in response.data] == [project.id]


def test_deleted_project_excluded_from_list(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/")
    response = client_for(manager_level2).get("/api/v1/projects/")
    assert response.data == []


# --- Detalle ---------------------------------------------------------------------


def test_retrieve_404_for_non_participant_non_manager(manager_level2, assistant_level1, stranger):
    """Nexo respondía 403; aquí no se revela que existe."""
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).get(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 404
    assert response.data["error"]["code"] == "not_found"


def test_retrieve_200_for_responsible(manager_level2, assistant_level1):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(assistant_level1).get(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200
    assert response.data["id"] == project.id
    assert response.data["can_manage"] is True
    assert response.data["can_delete"] is False


def test_retrieve_404_for_missing_project(manager_level2):
    response = client_for(manager_level2).get("/api/v1/projects/999999/")
    assert response.status_code == 404


def test_retrieve_404_for_deleted_project(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/")
    response = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 404


def test_user_ref_includes_roles(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    assert response.data["responsible"]["roles"] == [{"id": ANY, "name": "ANALISTA_CC"}]


def test_list_includes_phase_comment_document_counts(manager_level2):
    client = client_for(manager_level2)
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client.post(f"/api/v1/projects/{project.id}/phases/", {"name": "Descubrimiento"}, format="json")
    client.post(
        f"/api/v1/projects/{project.id}/comments/", {"text": "Avance inicial"}, format="json"
    )
    response = client.post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "acta.pdf", "file_data": PDF_B64},
        format="json",
    )
    assert response.status_code == 201, response.data
    response = client.get("/api/v1/projects/")
    item = response.data[0]
    assert item["phase_count"] == 1
    assert item["comment_count"] == 1
    assert item["document_count"] == 1


def test_detail_includes_activity_count(manager_level2):
    client = client_for(manager_level2)
    project = create_project(creator=manager_level2, responsible=manager_level2)
    client.post(
        f"/api/v1/projects/{project.id}/activities/",
        {
            "description": "Reunión de seguimiento con el equipo",
            "start_time": "09:00",
            "end_time": "10:00",
        },
        format="json",
    )
    response = client.get(f"/api/v1/projects/{project.id}/")
    assert response.data["activity_count"] == 1


# --- Edición (PATCH) ----------------------------------------------------------------


def test_partial_update_requires_manager_permission(manager_level2, assistant_level1, stranger):
    """Quien ni lo ve: 404."""
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).patch(
        f"/api/v1/projects/{project.id}/", {"name": "Nuevo nombre"}, format="json"
    )
    assert response.status_code == 404


def test_participant_sees_but_cannot_edit(manager_level2, assistant_level1, stranger):
    project = create_project(
        creator=manager_level2, responsible=assistant_level1, participant_ids=[stranger.id]
    )
    response = client_for(stranger).patch(
        f"/api/v1/projects/{project.id}/", {"name": "Nuevo nombre"}, format="json"
    )
    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"


def test_partial_update_name_does_not_log_history(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"name": "Nuevo nombre"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["name"] == "Nuevo nombre"
    assert not ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.ACTUALIZADO
    ).exists()


def test_partial_update_status_change_logs_history_and_completed_at(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"status": "COMPLETADO"}, format="json"
    )
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.status == Project.Status.COMPLETADO
    assert project.completed_at is not None
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.ESTADO_CAMBIADO
    ).exists()


def test_partial_update_responsible_change_logs_history_and_upserts_participant(
    manager_level2, assistant_level1
):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"responsible": assistant_level1.id}, format="json"
    )
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.responsible_id == assistant_level1.id
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).exists()
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.RESPONSABLE_CAMBIADO
    ).exists()


def test_partial_update_invalid_responsible_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).patch(
        f"/api/v1/projects/{project.id}/", {"responsible": 999999}, format="json"
    )
    assert response.status_code == 400


def test_target_date_before_start_returns_400(manager_level2):
    response = client_for(manager_level2).post(
        "/api/v1/projects/",
        project_payload(manager_level2, target_date="2026-07-01T00:00:00Z"),
        format="json",
    )
    assert response.status_code == 400
    assert "target_date" in response.data["error"]["details"]


# --- Eliminación (a la papelera) ------------------------------------------------------


def test_admin_gh_can_destroy_any_project(admin_gh, manager_level2):
    """Decisión del 05/11/2026: el Administrador de Gestión Humana también
    envía a la papelera los proyectos que no creó."""
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(admin_gh).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.deleted_at is not None


def test_destroy_requires_creator_even_for_responsible(manager_level2, assistant_level1):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(assistant_level1).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 403


def test_creator_can_destroy_own_project(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).delete(f"/api/v1/projects/{project.id}/")
    assert response.status_code == 200
    project.refresh_from_db()
    assert project.deleted_at is not None
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.ELIMINADO
    ).exists()
