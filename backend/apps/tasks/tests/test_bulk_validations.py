"""Regularización en bloque de Tiempo Objetivo y Fecha Fin y el listado de
pendientes (portado de Nexo, `tasks/tests/test_bulk_validations.py`).
Adaptación: el «usuarios.editar» de Nexo es aquí `tareas.validar`; el rol de
la persona puede ser global o de su membresía en la empresa."""

import pytest
from django.utils import timezone

from apps.tasks.models import EndDateAuditLog, TargetTimeAuditLog, Task
from apps.users.models import User

from .conftest import client_for, set_role

pytestmark = pytest.mark.django_db


@pytest.fixture
def regularizer():
    """Jefe Nacional: tiene `tareas.regularizar`."""
    user = User.objects.create_user(
        username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!"
    )
    set_role(user, "JEFE_NACIONAL")
    return user


@pytest.fixture
def regularizer_client(regularizer):
    return client_for(regularizer)


@pytest.fixture
def manager():
    """Coordinador Nacional: tiene `tareas.validar` pero no
    `tareas.regularizar` — valida una por una, no en bloque."""
    user = User.objects.create_user(
        username="coord", email="coord@example.com", password="Sup3r-Secr3t!"
    )
    set_role(user, "COORDINADOR_NACIONAL")
    return user


@pytest.fixture
def manager_client(manager):
    return client_for(manager)


@pytest.fixture
def collaborator():
    user = User.objects.create_user(
        username="collab", email="collab@example.com", password="Sup3r-Secr3t!"
    )
    set_role(user, "ANALISTA_CC")
    return user


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


# --- CanRegularize (gate compartido por los 3 endpoints) --------------------


def test_manager_without_regularizar_cannot_bulk_validate(manager_client, collaborator, manager):
    task = _task(collaborator, manager)

    response = manager_client.post(
        "/api/v1/tasks/target-time/bulk-validate/",
        {"task_ids": [task.id], "new_value": 8, "reason": "COMPLEJIDAD_DETECTADA"},
        format="json",
    )

    assert response.status_code == 403


def test_manager_without_can_regularize_cannot_bulk_approve_end_date(
    manager_client, collaborator, manager
):
    task = _task(collaborator, manager)

    response = manager_client.post(
        "/api/v1/tasks/end-date/bulk-approve/", {"items": [{"task_id": task.id}]}, format="json"
    )

    assert response.status_code == 403


def test_manager_without_can_regularize_cannot_list_pending(manager_client):
    response = manager_client.get("/api/v1/tasks/validations/pending/")

    assert response.status_code == 403


# --- bulk-validate (Tiempo Objetivo) -----------------------------------------


def test_bulk_validate_updates_eligible_and_skips_self_assigned(
    regularizer_client, regularizer, collaborator
):
    own_task = _task(regularizer, regularizer)
    task_a = _task(collaborator, regularizer)
    task_b = _task(collaborator, regularizer)

    response = regularizer_client.post(
        "/api/v1/tasks/target-time/bulk-validate/",
        {
            "task_ids": [own_task.id, task_a.id, task_b.id],
            "new_value": 6.5,
            "reason": "PROCEDIMIENTO_ESTANDAR",
        },
        format="json",
    )

    assert response.status_code == 200
    assert response.data["updated_count"] == 2
    assert response.data["skipped_self_assigned"] == [own_task.id]

    task_a.refresh_from_db()
    task_b.refresh_from_db()
    own_task.refresh_from_db()
    assert task_a.target_time_validated == 6.5
    assert task_b.target_time_validated == 6.5
    assert own_task.target_time_validated is None
    assert TargetTimeAuditLog.objects.filter(task_id=task_a.id).count() == 1
    assert TargetTimeAuditLog.objects.filter(task_id=task_b.id).count() == 1


def test_bulk_validate_ignores_nonexistent_task_ids(regularizer_client, regularizer, collaborator):
    task = _task(collaborator, regularizer)

    response = regularizer_client.post(
        "/api/v1/tasks/target-time/bulk-validate/",
        {"task_ids": [task.id, 999999], "new_value": 4, "reason": "REVISION_LIDER"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["updated_count"] == 1
    assert response.data["skipped_self_assigned"] == []


def test_bulk_validate_reason_otro_requires_detail(regularizer_client, regularizer, collaborator):
    task = _task(collaborator, regularizer)

    response = regularizer_client.post(
        "/api/v1/tasks/target-time/bulk-validate/",
        {"task_ids": [task.id], "new_value": 4, "reason": "OTRO"},
        format="json",
    )

    assert response.status_code == 400


def test_bulk_validate_rejects_empty_task_ids(regularizer_client):
    response = regularizer_client.post(
        "/api/v1/tasks/target-time/bulk-validate/",
        {"task_ids": [], "new_value": 4, "reason": "REVISION_LIDER"},
        format="json",
    )

    assert response.status_code == 400


# --- bulk-approve (Fecha Fin) ------------------------------------------------


def test_bulk_approve_without_new_end_date_approves_without_changing(
    regularizer_client, regularizer, collaborator
):
    task = _task(collaborator, regularizer)
    original_end_date = task.end_date

    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/", {"items": [{"task_id": task.id}]}, format="json"
    )

    assert response.status_code == 200
    assert response.data["updated_count"] == 1
    task.refresh_from_db()
    assert task.end_date_approval_status == "APROBADA"
    assert task.end_date == original_end_date
    assert EndDateAuditLog.objects.get(task_id=task.id).action == "APROBADA"


def test_bulk_approve_with_different_new_end_date_modifies(
    regularizer_client, regularizer, collaborator
):
    task = _task(collaborator, regularizer)
    new_date = task.end_date + timezone.timedelta(days=5)

    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/",
        {"items": [{"task_id": task.id, "new_end_date": new_date.isoformat()}]},
        format="json",
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.end_date_approval_status == "MODIFICADA"
    assert task.end_date == new_date
    assert EndDateAuditLog.objects.get(task_id=task.id).action == "MODIFICADA"


def test_bulk_approve_with_same_new_end_date_treated_as_approve(
    regularizer_client, regularizer, collaborator
):
    task = _task(collaborator, regularizer)

    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/",
        {"items": [{"task_id": task.id, "new_end_date": task.end_date.isoformat()}]},
        format="json",
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.end_date_approval_status == "APROBADA"


def test_bulk_approve_skips_date_before_start_date(regularizer_client, regularizer, collaborator):
    start = timezone.now()
    task = _task(
        collaborator, regularizer, start_date=start, end_date=start + timezone.timedelta(days=10)
    )
    invalid_date = start - timezone.timedelta(days=1)

    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/",
        {"items": [{"task_id": task.id, "new_end_date": invalid_date.isoformat()}]},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["updated_count"] == 0
    assert response.data["skipped_invalid_date"] == [task.id]
    task.refresh_from_db()
    assert task.end_date_approval_status == "PENDIENTE"


def test_bulk_approve_skips_self_assigned(regularizer_client, regularizer):
    own_task = _task(regularizer, regularizer)

    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/", {"items": [{"task_id": own_task.id}]}, format="json"
    )

    assert response.status_code == 200
    assert response.data["updated_count"] == 0
    assert response.data["skipped_self_assigned"] == [own_task.id]


def test_bulk_approve_ignores_nonexistent_task_id_without_breaking_batch(
    regularizer_client, regularizer, collaborator
):
    task = _task(collaborator, regularizer)

    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/",
        {"items": [{"task_id": 999999}, {"task_id": task.id}]},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["updated_count"] == 1


def test_bulk_approve_rejects_empty_items(regularizer_client):
    response = regularizer_client.post(
        "/api/v1/tasks/end-date/bulk-approve/", {"items": []}, format="json"
    )

    assert response.status_code == 400


# --- validations/pending -----------------------------------------------------


def test_pending_lists_task_needing_target_time_or_end_date(
    regularizer_client, regularizer, collaborator
):
    needs_target_time = _task(collaborator, regularizer, title="A")
    needs_end_date = _task(collaborator, regularizer, title="B", target_time_validated=5)
    fully_decided = _task(
        collaborator,
        regularizer,
        title="C",
        target_time_validated=5,
        end_date_approval_status=Task.EndDateApprovalStatus.APROBADA,
    )

    response = regularizer_client.get("/api/v1/tasks/validations/pending/")

    assert response.status_code == 200
    ids = {t["id"] for t in response.data["tasks"]}
    assert needs_target_time.id in ids
    assert needs_end_date.id in ids
    assert fully_decided.id not in ids


def test_pending_filters_by_user_id_role_and_type(regularizer_client, regularizer, collaborator):
    other = User.objects.create_user(
        username="other", email="other@example.com", password="Sup3r-Secr3t!"
    )
    set_role(other, "ANALISTA_CC")

    mine = _task(collaborator, regularizer, title="mine", type=Task.Type.SEGUIMIENTO)
    other_task = _task(other, regularizer, title="other", type=Task.Type.FIJA)

    by_user = regularizer_client.get(
        f"/api/v1/tasks/validations/pending/?user_id={collaborator.id}"
    )
    ids = {t["id"] for t in by_user.data["tasks"]}
    assert mine.id in ids and other_task.id not in ids

    by_type = regularizer_client.get("/api/v1/tasks/validations/pending/?type=FIJA")
    ids = {t["id"] for t in by_type.data["tasks"]}
    assert other_task.id in ids and mine.id not in ids

    by_role = regularizer_client.get("/api/v1/tasks/validations/pending/?role=ANALISTA_CC")
    ids = {t["id"] for t in by_role.data["tasks"]}
    assert mine.id in ids and other_task.id in ids


def test_pending_invalid_role_and_type_are_ignored_not_filtered(
    regularizer_client, regularizer, collaborator
):
    task = _task(collaborator, regularizer)

    response = regularizer_client.get(
        "/api/v1/tasks/validations/pending/?role=ROL_INEXISTENTE&type=NO_ES_UN_TIPO"
    )

    assert response.status_code == 200
    ids = {t["id"] for t in response.data["tasks"]}
    assert task.id in ids


def test_data_quality_all_validated_is_100_pct(regularizer_client, regularizer, collaborator):
    _task(
        collaborator,
        regularizer,
        target_time_validated=5,
        end_date_approval_status=Task.EndDateApprovalStatus.APROBADA,
    )

    response = regularizer_client.get("/api/v1/tasks/validations/pending/")

    assert response.data["target_time_data_quality"] == {
        "validated_count": 1,
        "pending_count": 0,
        "total_count": 1,
        "validated_pct": 100,
        "pending_pct": 0,
    }
    assert response.data["end_date_data_quality"] == {
        "validated_count": 1,
        "pending_count": 0,
        "total_count": 1,
        "validated_pct": 100,
        "pending_pct": 0,
    }


def test_data_quality_with_no_tasks_is_100_pct_by_convention(regularizer_client):
    response = regularizer_client.get("/api/v1/tasks/validations/pending/")

    assert response.data["target_time_data_quality"]["total_count"] == 0
    assert response.data["target_time_data_quality"]["validated_pct"] == 100
    assert response.data["end_date_data_quality"]["validated_pct"] == 100


def test_data_quality_counts_rechazada_as_not_pending(
    regularizer_client, regularizer, collaborator
):
    _task(
        collaborator,
        regularizer,
        target_time_validated=5,
        end_date_approval_status=Task.EndDateApprovalStatus.RECHAZADA,
    )

    response = regularizer_client.get("/api/v1/tasks/validations/pending/")

    # RECHAZADA no es PENDIENTE, así que cuenta como "validada" a efectos
    # de este %, igual que el legacy (discrepancia deliberada, ver plan).
    assert response.data["end_date_data_quality"]["validated_pct"] == 100


def test_pending_filters_by_role_given_in_the_company_membership(regularizer_client, regularizer):
    """El rol puede venir de la membresía en la empresa (lo normal en la
    intranet), no solo de los roles globales."""
    from django.contrib.auth.models import Group

    from apps.empresas.contexto import empresa_actual

    por_membresia = User.objects.create_user(
        username="memb", email="memb@example.com", password="Sup3r-Secr3t!"
    )
    por_membresia.membresias.get(empresa=empresa_actual()).roles.add(
        Group.objects.get(name="TRABAJO_SOCIAL")
    )
    task = _task(por_membresia, regularizer)

    response = regularizer_client.get("/api/v1/tasks/validations/pending/?role=TRABAJO_SOCIAL")

    assert {t["id"] for t in response.data["tasks"]} == {task.id}
    assert response.data["target_time_data_quality"]["total_count"] == 1
