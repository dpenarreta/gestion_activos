"""Registro retroactivo de horas (portado de Nexo,
`tasks/tests/test_activity_retroactive.py`). Adaptaciones: los roles a los que
se avisa salen de los ajustes del módulo (`tasks_retroactive_notify_roles`,
por defecto el Coordinador Nacional) y el aviso es de la campana."""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.tasks.business_time import (
    business_calendar_day,
    previous_business_days,
    retroactive_valid_dates,
    weekend_grace_days,
)
from apps.tasks.models import ActivityReason, Task, TaskActivity
from apps.users.models import User

from .conftest import client_for, notifications, set_role, task_id_of

pytestmark = pytest.mark.django_db


@pytest.fixture
def collaborator():
    user = User.objects.create_user(
        username="collab", email="collab@example.com", password="Sup3r-Secr3t!"
    )
    set_role(user, "ANALISTA_CC")
    return user


@pytest.fixture
def collaborator_client(collaborator):
    return client_for(collaborator)


def _make_reason_for(user: User, key: str = "trabajo_general") -> ActivityReason:
    role_names = list(user.groups.values_list("name", flat=True))
    return ActivityReason.objects.create(
        key=key, label="Trabajo general", assigned_roles=role_names
    )


def _task(assigned_to: User, created_by: User, task_type: str = "SEGUIMIENTO") -> Task:
    return Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        type=task_type,
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=assigned_to,
        created_by=created_by,
    )


def _a_valid_date() -> date:
    today = business_calendar_day(timezone.now())
    return retroactive_valid_dates(today, 2)[0]


# --- helpers puros de business_time.py --------------------------------------


def test_previous_business_days_skips_weekends():
    # 2026-01-14 (miércoles) -> últimos 3 días hábiles antes: 13,12,9
    days = previous_business_days(date(2026, 1, 14), 3)
    assert days == [date(2026, 1, 13), date(2026, 1, 12), date(2026, 1, 9)]


def test_weekend_grace_days_only_monday_or_tuesday():
    assert weekend_grace_days(date(2026, 1, 12)) == [date(2026, 1, 11), date(2026, 1, 10)]  # lunes
    assert weekend_grace_days(date(2026, 1, 13)) == [date(2026, 1, 11), date(2026, 1, 10)]  # martes
    assert weekend_grace_days(date(2026, 1, 14)) == []  # miércoles


def test_retroactive_valid_dates_combines_business_days_and_weekend_grace():
    # Lunes 2026-01-12, ventana de 2 días hábiles -> viernes 9, jueves 8
    # (business days) + domingo 11, sábado 10 (gracia) -> desc: 11,10,9,8
    dates = retroactive_valid_dates(date(2026, 1, 12), 2)
    assert dates == [date(2026, 1, 11), date(2026, 1, 10), date(2026, 1, 9), date(2026, 1, 8)]


# --- registro retroactivo vía API --------------------------------------------


def test_retroactive_activity_valid_date_succeeds(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    valid_date = _a_valid_date()

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 30,
            "description": "Trabajo de un día anterior",
            "activity_date": valid_date.isoformat(),
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.data["is_retroactive"] is True
    task.refresh_from_db()
    assert task.real_hours == 1.5


def test_retroactive_activity_backdates_created_at(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    valid_date = _a_valid_date()

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": valid_date.isoformat(),
        },
        format="json",
    )

    activity = TaskActivity.objects.get(id=response.data["id"])
    assert activity.created_at.date() == valid_date


def test_retroactive_activity_requires_description(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    valid_date = _a_valid_date()

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "",
            "activity_date": valid_date.isoformat(),
        },
        format="json",
    )

    assert response.status_code == 400


def test_retroactive_activity_rejects_fija_task(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="FIJA")
    valid_date = _a_valid_date()

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": valid_date.isoformat(),
        },
        format="json",
    )

    assert response.status_code == 400


def test_retroactive_activity_rejects_date_outside_window(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    too_old = (timezone.now() - timedelta(days=30)).date().isoformat()

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": too_old,
        },
        format="json",
    )

    assert response.status_code == 400


def test_retroactive_activity_invalid_date_format_rejected(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": "not-a-date",
        },
        format="json",
    )

    assert response.status_code == 400


def test_retroactive_activity_overlap_rejected(collaborator_client, collaborator):
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    valid_date = _a_valid_date()

    first = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": valid_date.isoformat(),
            "start_time": "09:00",
            "end_time": "10:00",
        },
        format="json",
    )
    second = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d2",
            "activity_date": valid_date.isoformat(),
            "start_time": "09:30",
            "end_time": "10:30",
        },
        format="json",
    )

    assert first.status_code == 201
    assert second.status_code == 400


def test_retroactive_activity_notifies_coordinador_nacional(collaborator_client, collaborator):
    coordinador = User.objects.create_user(
        username="coord", email="coord@example.com", password="Sup3r-Secr3t!"
    )
    set_role(coordinador, "COORDINADOR_NACIONAL")
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    valid_date = _a_valid_date()

    collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": valid_date.isoformat(),
        },
        format="json",
    )

    notification = notifications(coordinador).get()
    assert task.title in notification.resumen
    assert task_id_of(notification) == task.id
    assert notification.tipo == "tareas.retroactivo"


def test_retroactive_activity_uses_custom_notify_roles_when_configured(
    collaborator_client, collaborator
):
    """Los roles a los que se avisa se configuran (en Nexo,
    `notification_rules.retroactive_notify_roles`)."""
    from apps.tasks.configuracion import save_settings

    coordinador = User.objects.create_user(
        username="coord3", email="coord3@example.com", password="Sup3r-Secr3t!"
    )
    set_role(coordinador, "COORDINADOR_NACIONAL")
    jefe = User.objects.create_user(
        username="jefe5", email="jefe5@example.com", password="Sup3r-Secr3t!"
    )
    set_role(jefe, "JEFE_NACIONAL")
    save_settings({"retroactive_notify_roles": ["JEFE_NACIONAL"]}, collaborator)
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    valid_date = _a_valid_date()

    collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": valid_date.isoformat(),
        },
        format="json",
    )

    assert notifications(jefe).exists()
    assert not notifications(coordinador).exists()


def test_retroactive_window_comes_from_the_module_settings(collaborator_client, collaborator):
    """La ventana (días hábiles hacia atrás) es un ajuste con vigencia."""
    from apps.tasks.configuracion import save_settings

    save_settings({"retroactive_window_business_days": 5}, collaborator)
    _make_reason_for(collaborator)
    task = _task(collaborator, collaborator, task_type="SEGUIMIENTO")
    today = business_calendar_day(timezone.now())
    fifth = previous_business_days(today, 5)[-1]

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/activities/retroactive/",
        {
            "reason": "trabajo_general",
            "hours": 1,
            "minutes": 0,
            "description": "d",
            "activity_date": fifth.isoformat(),
        },
        format="json",
    )

    assert response.status_code == 201
