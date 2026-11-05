"""Validación de Tiempo Objetivo y decisión de Fecha Fin (portado de Nexo,
`tasks/tests/test_target_time_end_date.py`). Adaptaciones: el `usuarios.editar`
de Nexo es aquí `tareas.validar`; sin ese permiso la respuesta es 403 (en
Nexo, 400) y validar la propia tarea sigue siendo 400; los avisos son de la
campana y en «usted»."""

from datetime import timezone as dt_timezone

import pytest
from django.utils import timezone

from apps.tasks.models import EndDateAuditLog, TargetTimeAuditLog, Task
from apps.users.models import User

from .conftest import client_for, grant_permission, notifications, set_role, task_id_of

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


@pytest.fixture
def manager():
    user = User.objects.create_user(
        username="manager", email="manager@example.com", password="Sup3r-Secr3t!"
    )
    grant_permission(user, "tareas.validar")
    return user


@pytest.fixture
def manager_client(manager):
    return client_for(manager)


def _task(assigned_to: User, created_by: User, **overrides) -> Task:
    fields = {
        "title": "Preparar informe",
        "priority": "MEDIA",
        "frequency": "PUNTUAL",
        "start_date": timezone.now(),
        "end_date": timezone.now(),
        "estimated_hours": 5,
        "assigned_to": assigned_to,
        "created_by": created_by,
    }
    fields.update(overrides)
    return Task.objects.create(**fields)


# --- Tiempo Objetivo --------------------------------------------------------


def test_manager_validates_target_time_and_creates_audit_log(manager_client, manager, collaborator):
    task = _task(collaborator, manager)

    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/target-time/",
        {"new_value": 8, "reason": "COMPLEJIDAD_DETECTADA"},
        format="json",
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.target_time_validated == 8
    assert task.target_time_validated_by_id == manager.id
    log = TargetTimeAuditLog.objects.get(task_id=task.id)
    assert log.new_value == 8
    assert log.user_id == manager.id
    assert log.user_role == ""  # el permiso es directo: no tiene rol de Gestión Humana


def test_assignee_cannot_validate_own_target_time(collaborator_client, collaborator):
    # Aquí ni siquiera tiene el permiso: 403 (en Nexo, 400).
    task = _task(collaborator, collaborator)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/target-time/",
        {"new_value": 8, "reason": "COMPLEJIDAD_DETECTADA"},
        format="json",
    )

    assert response.status_code == 403
    task.refresh_from_db()
    assert task.target_time_validated is None


def test_manager_cannot_validate_own_assigned_task(manager_client, manager):
    task = _task(manager, manager)

    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/target-time/",
        {"new_value": 8, "reason": "COMPLEJIDAD_DETECTADA"},
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "own_task"


def test_actor_without_tareas_validar_cannot_validate(collaborator_client, collaborator, manager):
    task = _task(collaborator, manager)
    # collaborator no tiene tareas.validar
    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/target-time/",
        {"new_value": 8, "reason": "COMPLEJIDAD_DETECTADA"},
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_reason_otro_requires_detail(manager_client, collaborator, manager):
    task = _task(collaborator, manager)

    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/target-time/", {"new_value": 8, "reason": "OTRO"}, format="json"
    )

    assert response.status_code == 400


def test_target_time_get_info_reflects_official_target_and_deviation(
    manager_client, collaborator, manager
):
    task = _task(collaborator, manager, estimated_hours=4, real_hours=6)

    response = manager_client.get(f"/api/v1/tasks/{task.id}/target-time/")

    assert response.status_code == 200
    assert response.data["official_target"] == 4
    assert response.data["is_validated"] is False
    assert response.data["deviation"]["hours"] == 2
    assert response.data["can_validate"] is True


def test_historical_deviation_averages_completed_tasks_with_same_title(
    manager_client, collaborator, manager
):
    for real_hours in (4, 6):
        Task.objects.create(
            title="Preparar informe",
            priority="MEDIA",
            frequency="PUNTUAL",
            start_date=timezone.now(),
            end_date=timezone.now(),
            estimated_hours=5,
            real_hours=real_hours,
            status="COMPLETADA",
            completed_at=timezone.now(),
            assigned_to=collaborator,
            created_by=manager,
        )
    task = _task(collaborator, manager)

    response = manager_client.get(f"/api/v1/tasks/{task.id}/target-time/")

    assert response.data["historical_deviation"]["available"] is True
    assert response.data["historical_deviation"]["sample_size"] == 2
    assert response.data["historical_deviation"]["avg_real_hours"] == 5.0


# --- Fecha Fin ---------------------------------------------------------------


def test_manager_approves_end_date(manager_client, manager, collaborator):
    task = _task(collaborator, manager)

    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/end-date/", {"action": "APROBAR"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.end_date_approval_status == "APROBADA"
    assert EndDateAuditLog.objects.filter(task_id=task.id, action="APROBADA").exists()


def test_manager_modifies_end_date_requires_new_date(manager_client, manager, collaborator):
    task = _task(collaborator, manager)

    missing_date = manager_client.post(
        f"/api/v1/tasks/{task.id}/end-date/", {"action": "MODIFICAR"}, format="json"
    )
    assert missing_date.status_code == 400

    new_date = timezone.now() + timezone.timedelta(days=10)
    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/end-date/",
        {"action": "MODIFICAR", "new_end_date": new_date.isoformat()},
        format="json",
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.end_date_approval_status == "MODIFICADA"
    assert task.end_date.date() == new_date.date()


def test_manager_rejects_end_date_without_changing_it(manager_client, manager, collaborator):
    task = _task(collaborator, manager)
    original_end_date = task.end_date

    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/end-date/", {"action": "RECHAZAR"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.end_date_approval_status == "RECHAZADA"
    assert task.end_date == original_end_date


def test_assignee_cannot_decide_own_end_date(collaborator_client, collaborator, manager):
    task = _task(collaborator, manager)

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/end-date/", {"action": "APROBAR"}, format="json"
    )

    assert response.status_code == 403  # sin `tareas.validar` (en Nexo, 400)


# --- Notificación al colaborador (cierra el gap documentado en la Fase 3c) --


def test_approving_end_date_never_notifies(manager_client, manager, collaborator):
    task = _task(collaborator, manager)

    manager_client.post(f"/api/v1/tasks/{task.id}/end-date/", {"action": "APROBAR"}, format="json")

    assert not notifications(collaborator).exists()


def _fecha_local(fecha):
    """Como la formatea el servicio: la fecha fin es un día guardado como
    medianoche UTC, así que el día se lee en UTC (a cualquier hora)."""
    return fecha.astimezone(dt_timezone.utc).strftime("%d/%m/%Y")


def test_modifying_end_date_notifies_assignee_with_exact_message(
    manager_client, manager, collaborator
):
    task = _task(collaborator, manager)
    original_end_date = task.end_date
    new_date = timezone.now() + timezone.timedelta(days=10)

    manager_client.post(
        f"/api/v1/tasks/{task.id}/end-date/",
        {
            "action": "MODIFICAR",
            "new_end_date": new_date.isoformat(),
            "observaciones": "Ajuste de cronograma",
        },
        format="json",
    )

    notification = notifications(collaborator).get()
    prev_fmt = _fecha_local(original_end_date)
    new_fmt = _fecha_local(new_date)
    assert notification.resumen == (
        f'Su fecha de finalización para la actividad "{task.title}" fue ajustada por su jefe '
        f"de {prev_fmt} a {new_fmt}. Observación: Ajuste de cronograma"
    )
    assert task_id_of(notification) == task.id


def test_rejecting_end_date_notifies_assignee_with_exact_message(
    manager_client, manager, collaborator
):
    task = _task(collaborator, manager)
    original_end_date = task.end_date

    manager_client.post(f"/api/v1/tasks/{task.id}/end-date/", {"action": "RECHAZAR"}, format="json")

    notification = notifications(collaborator).get()
    prev_fmt = _fecha_local(original_end_date)
    assert notification.resumen == (
        f"Su jefe rechazó la fecha de finalización propuesta ({prev_fmt}) para la actividad "
        f'"{task.title}". Debe proponer una nueva fecha.'
    )


# --- Reinicio a Pendiente al reeditar end_date -------------------------------


def test_assignee_editing_end_date_after_decision_resets_to_pendiente_and_audits(
    collaborator_client, collaborator, manager
):
    task = _task(collaborator, manager)
    from apps.tasks.services import EndDateService

    EndDateService.apply_action(
        actor=manager, task=task, action="APROBAR", new_end_date=None, observaciones=None
    )
    task.refresh_from_db()
    assert task.end_date_approval_status == "APROBADA"

    new_date = timezone.now() + timezone.timedelta(days=20)
    response = collaborator_client.patch(
        f"/api/v1/tasks/{task.id}/", {"end_date": new_date.isoformat()}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.end_date_approval_status == "PENDIENTE"
    assert task.end_date_approved_at is None
    assert EndDateAuditLog.objects.filter(task_id=task.id, action="PROPUESTA").exists()


def test_editing_end_date_while_still_pendiente_does_not_audit(
    collaborator_client, collaborator, manager
):
    task = _task(collaborator, manager)
    assert task.end_date_approval_status == "PENDIENTE"

    new_date = timezone.now() + timezone.timedelta(days=5)
    response = collaborator_client.patch(
        f"/api/v1/tasks/{task.id}/", {"end_date": new_date.isoformat()}, format="json"
    )

    assert response.status_code == 200
    assert EndDateAuditLog.objects.filter(task_id=task.id).count() == 0


def test_modifying_end_date_before_start_is_rejected(manager_client, manager, collaborator):
    start = timezone.now()
    task = _task(
        collaborator, manager, start_date=start, end_date=start + timezone.timedelta(days=3)
    )

    response = manager_client.post(
        f"/api/v1/tasks/{task.id}/end-date/",
        {"action": "MODIFICAR", "new_end_date": (start - timezone.timedelta(days=1)).isoformat()},
        format="json",
    )

    assert response.status_code == 400
    task.refresh_from_db()
    assert task.end_date_approval_status == "PENDIENTE"


def test_coordinator_role_gives_tareas_validar(collaborator):
    """La migración `tasks/0002` le da `tareas.validar` al Coordinador
    Nacional (en Nexo, `usuarios.editar`)."""
    coordinador = User.objects.create_user(
        username="coord", email="coord@example.com", password="Sup3r-Secr3t!"
    )
    set_role(coordinador, "COORDINADOR_NACIONAL")
    task = _task(collaborator, coordinador)

    response = client_for(coordinador).post(
        f"/api/v1/tasks/{task.id}/target-time/",
        {"new_value": 3, "reason": "REVISION_LIDER"},
        format="json",
    )

    assert response.status_code == 200
    assert TargetTimeAuditLog.objects.get(task_id=task.id).user_role == "COORDINADOR_NACIONAL"
