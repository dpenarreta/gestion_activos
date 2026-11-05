"""Actividades, portado de Nexo (`test_project_activities.py`)."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.projects.models import (
    ProjectActivity,
    ProjectHistory,
    ProjectHistoryEvent,
    ProjectParticipant,
)
from apps.tasks.business_time import business_calendar_day, retroactive_valid_dates

from .conftest import client_for, create_project

pytestmark = pytest.mark.django_db


def _register_activity(*, actor, project, **overrides) -> dict:
    payload = {
        "description": "Reunión de seguimiento con el equipo",
        "start_time": "09:00",
        "end_time": "10:30",
    }
    payload.update(overrides)
    response = client_for(actor).post(
        f"/api/v1/projects/{project.id}/activities/", payload, format="json"
    )
    assert response.status_code == 201, response.data
    return response.data


def _register_activity_expect_400(*, actor, project, **overrides):
    payload = {
        "description": "Reunión de seguimiento con el equipo",
        "start_time": "09:00",
        "end_time": "10:00",
    }
    payload.update(overrides)
    return client_for(actor).post(
        f"/api/v1/projects/{project.id}/activities/", payload, format="json"
    )


# --- Registro normal ------------------------------------------------------------


def test_participant_registers_activity(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    activity = _register_activity(actor=assistant_level1, project=project)
    assert activity["duration"] == 90
    assert activity["is_retroactive"] is False
    assert activity["author"]["id"] == assistant_level1.id


def test_registering_activity_recalcs_project_real_hours(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _register_activity(actor=manager_level2, project=project, start_time="09:00", end_time="10:30")
    project.refresh_from_db()
    assert project.real_hours == 1.5


def test_non_participant_cannot_register_activity(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).post(
        f"/api/v1/projects/{project.id}/activities/",
        {"description": "Trabajo en el proyecto ajeno", "start_time": "09:00", "end_time": "10:00"},
        format="json",
    )
    assert response.status_code == 404


def test_activity_does_not_log_history(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _register_activity(actor=manager_level2, project=project)
    assert not ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.ACTIVIDAD_REGISTRADA
    ).exists()


def test_registering_activity_auto_adds_participant_with_history(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    assert not ProjectParticipant.objects.filter(project=project, user=manager_level2).exists()
    _register_activity(actor=manager_level2, project=project)
    assert ProjectParticipant.objects.filter(project=project, user=manager_level2).exists()
    entry = ProjectHistory.objects.get(
        project=project, event=ProjectHistoryEvent.PARTICIPANTE_AGREGADO
    )
    assert entry.new_value == {"user_id": manager_level2.id, "auto": True}


def test_registering_activity_does_not_duplicate_existing_participant(
    manager_level2, assistant_level1
):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    _register_activity(actor=assistant_level1, project=project)
    assert ProjectParticipant.objects.filter(project=project, user=assistant_level1).count() == 1


# --- Validaciones ------------------------------------------------------------------


def test_short_description_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _register_activity_expect_400(
        actor=manager_level2, project=project, description="corta"
    )
    assert response.status_code == 400
    assert "description" in response.data["error"]["details"]


def test_end_before_start_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _register_activity_expect_400(
        actor=manager_level2, project=project, start_time="10:00", end_time="09:00"
    )
    assert response.status_code == 400


def test_invalid_time_format_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _register_activity_expect_400(
        actor=manager_level2, project=project, start_time="25:99"
    )
    assert response.status_code == 400


def test_phase_from_another_project_returns_400(manager_level2):
    project_a = create_project(creator=manager_level2, responsible=manager_level2)
    project_b = create_project(
        creator=manager_level2, responsible=manager_level2, name="Otro proyecto"
    )
    phase_response = client_for(manager_level2).post(
        f"/api/v1/projects/{project_b.id}/phases/", {"name": "Fase B"}, format="json"
    )
    response = _register_activity_expect_400(
        actor=manager_level2, project=project_a, phase=phase_response.data["id"]
    )
    assert response.status_code == 400


def test_activity_linked_to_phase_in_same_project(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    phase_response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/phases/", {"name": "Descubrimiento"}, format="json"
    )
    activity = _register_activity(
        actor=manager_level2, project=project, phase=phase_response.data["id"]
    )
    assert activity["phase_id"] == phase_response.data["id"]

    detail = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/")
    phase_data = next(p for p in detail.data["phases"] if p["id"] == phase_response.data["id"])
    assert phase_data["registered_minutes"] == 90
    assert phase_data["participants"] == [
        {"id": manager_level2.id, "name": manager_level2.first_name or manager_level2.username}
    ]


# --- Registro retroactivo -------------------------------------------------------------


def test_retroactive_registration_with_valid_date(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    today = business_calendar_day(timezone.now())
    valid_dates = retroactive_valid_dates(today, 2)
    assert valid_dates
    target_date = valid_dates[0]

    activity = _register_activity(
        actor=manager_level2, project=project, activity_date=target_date.isoformat()
    )
    assert activity["is_retroactive"] is True
    stored = ProjectActivity.objects.get(id=activity["id"])
    assert stored.created_at.date() == target_date


def test_retroactive_registration_with_invalid_date_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    far_past = business_calendar_day(timezone.now()) - timedelta(days=60)
    response = _register_activity_expect_400(
        actor=manager_level2, project=project, activity_date=far_past.isoformat()
    )
    assert response.status_code == 400


def test_activity_date_matching_today_is_not_retroactive(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    today = business_calendar_day(timezone.now())
    activity = _register_activity(
        actor=manager_level2, project=project, activity_date=today.isoformat()
    )
    assert activity["is_retroactive"] is False


def test_invalid_activity_date_format_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _register_activity_expect_400(
        actor=manager_level2, project=project, activity_date="not-a-date"
    )
    assert response.status_code == 400


# --- Listado -------------------------------------------------------------------------


def test_list_activities_visible_to_viewer(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=assistant_level1, participant_ids=[assistant_level1.id]
    )
    _register_activity(actor=assistant_level1, project=project)
    response = client_for(assistant_level1).get(f"/api/v1/projects/{project.id}/activities/")
    assert response.status_code == 200
    assert len(response.data) == 1


def test_list_activities_hidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).get(f"/api/v1/projects/{project.id}/activities/")
    assert response.status_code == 404
