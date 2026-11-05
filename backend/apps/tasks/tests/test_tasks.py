"""CRUD de tareas y comentarios (portado de Nexo, `tasks/tests/test_tasks.py`).

Adaptaciones: el `usuarios.editar` de Nexo es aquí `tareas.validar`; la
jerarquía (a quién se asigna, de quién se ven las tareas, a quién se avisa de
un comentario) sale del organigrama; una tarea que la persona no ve responde
404 en lugar de 403; los avisos son de la campana."""

import pytest
from django.utils import timezone

from apps.tasks.configuracion import save_settings
from apps.tasks.models import Comment, Task, TaskCommentView
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import (
    client_for,
    grant_permission,
    notifications,
    organigrama,
    set_role,
    task_id_of,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def collaborator():
    return User.objects.create_user(
        username="collab", email="collab@example.com", password="Sup3r-Secr3t!"
    )


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


@pytest.fixture
def stranger():
    return User.objects.create_user(
        username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def stranger_client(stranger):
    return client_for(stranger)


def _task_payload(assigned_to: User, **overrides) -> dict:
    payload = {
        "title": "Preparar informe",
        "priority": "ALTA",
        "frequency": "PUNTUAL",
        "start_date": "2026-08-01T00:00:00Z",
        "end_date": "2026-08-10T00:00:00Z",
        "estimated_hours": 5,
        "assigned_to": assigned_to.id,
    }
    payload.update(overrides)
    return payload


def _task(assigned_to: User, created_by: User, **overrides) -> Task:
    fields = {
        "title": "Tarea",
        "priority": "MEDIA",
        "frequency": "PUNTUAL",
        "start_date": timezone.now(),
        "end_date": timezone.now(),
        "estimated_hours": 1,
        "assigned_to": assigned_to,
        "created_by": created_by,
    }
    fields.update(overrides)
    return Task.objects.create(**fields)


# --- Creación --------------------------------------------------------------


def test_manager_creates_task_assigned_to_collaborator(manager, collaborator):
    set_role(manager, "COORDINADOR_NACIONAL")
    set_role(collaborator, "ANALISTA_CC")
    organigrama(manager, collaborator)

    response = client_for(manager).post(
        "/api/v1/tasks/", _task_payload(collaborator), format="json"
    )

    assert response.status_code == 201
    task = Task.objects.get(title="Preparar informe")
    assert task.created_by_id == manager.id
    assert task.assigned_to_id == collaborator.id
    assert task.status == Task.Status.PENDIENTE
    assert task.progress == 0


def test_creating_task_already_completed_sets_progress_and_completed_at(manager, collaborator):
    organigrama(manager, collaborator)

    response = client_for(manager).post(
        "/api/v1/tasks/", _task_payload(collaborator, status="COMPLETADA"), format="json"
    )

    assert response.status_code == 201
    task = Task.objects.get(title="Preparar informe")
    assert task.progress == 100
    assert task.completed_at is not None


def test_cannot_create_task_assigned_to_user_outside_visible_hierarchy():
    """Hallazgo de seguridad de Nexo (NEXO-01): la API debe repetir la
    restricción del selector. Aquí, fuera de su equipo en el organigrama."""
    actor = User.objects.create_user(
        username="asist_gh", email="asist_gh@example.com", password="Sup3r-Secr3t!"
    )
    set_role(actor, "ASISTENTE_GH")
    outsider = User.objects.create_user(
        username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!"
    )
    set_role(outsider, "ASISTENTE_SELECCION")

    response = client_for(actor).post("/api/v1/tasks/", _task_payload(outsider), format="json")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "assignee_out_of_scope"
    assert not Task.objects.filter(title="Preparar informe").exists()


def test_cannot_reassign_task_to_user_outside_visible_hierarchy(manager_client, manager):
    set_role(manager, "COORDINADOR_NACIONAL")
    outsider = User.objects.create_user(
        username="outsider", email="outsider@example.com", password="Sup3r-Secr3t!"
    )
    set_role(outsider, ADMIN_GH)
    task = _task(manager, manager, title="Tarea de manager")

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/", {"assigned_to": outsider.id}, format="json"
    )

    assert response.status_code == 400
    task.refresh_from_db()
    assert task.assigned_to_id == manager.id


def test_end_date_before_start_date_is_rejected(collaborator_client, collaborator):
    response = collaborator_client.post(
        "/api/v1/tasks/",
        _task_payload(
            collaborator, start_date="2026-08-10T00:00:00Z", end_date="2026-08-01T00:00:00Z"
        ),
        format="json",
    )
    assert response.status_code == 400
    assert "end_date" in response.json()["error"]["details"]


# --- Listado (solo propias) -------------------------------------------------


def test_list_only_returns_own_non_archived_tasks(collaborator_client, collaborator, stranger):
    own = _task(collaborator, collaborator, title="Propia")
    _task(collaborator, collaborator, title="Archivada", archived_month="2026-07")
    _task(stranger, stranger, title="De otra persona")

    response = collaborator_client.get("/api/v1/tasks/")

    assert response.status_code == 200
    assert {item["title"] for item in response.data} == {own.title}


# --- Edición: campos restringidos al propio responsable --------------------


def test_assignee_can_edit_self_only_fields(collaborator_client, collaborator, manager):
    task = _task(collaborator, manager)

    response = collaborator_client.patch(
        f"/api/v1/tasks/{task.id}/", {"status": "EN_PROGRESO"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == Task.Status.EN_PROGRESO


def test_creator_without_being_assignee_cannot_edit_self_only_fields(
    manager_client, collaborator, manager
):
    task = _task(collaborator, manager)

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/", {"status": "EN_PROGRESO"}, format="json"
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "self_only_field"
    task.refresh_from_db()
    assert task.status == Task.Status.PENDIENTE


def test_creator_can_edit_non_restricted_fields(manager_client, collaborator, manager):
    task = _task(collaborator, manager)

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/", {"title": "Tarea editada"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.title == "Tarea editada"


def test_changing_status_to_completada_sets_progress_100_and_completed_at(
    collaborator_client, collaborator, manager
):
    task = _task(collaborator, manager)

    response = collaborator_client.patch(
        f"/api/v1/tasks/{task.id}/", {"status": "COMPLETADA"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.progress == 100
    assert task.completed_at is not None


def test_stranger_cannot_view_or_edit_unrelated_task(stranger_client, collaborator, manager):
    """En Nexo respondía 403; aquí 404: no se revela que la tarea existe."""
    task = _task(collaborator, manager)

    assert stranger_client.get(f"/api/v1/tasks/{task.id}/").status_code == 404
    response = stranger_client.patch(
        f"/api/v1/tasks/{task.id}/", {"title": "Hackeada"}, format="json"
    )

    assert response.status_code == 404
    task.refresh_from_db()
    assert task.title == "Tarea"


def test_boss_in_the_organigrama_sees_and_edits_team_task(manager, collaborator, stranger):
    """Lo que en Nexo-Django era un pendiente («el jefe solo entra con
    `usuarios.editar`»): el organigrama da la visibilidad."""
    organigrama(stranger, collaborator)
    task = _task(collaborator, manager)

    client = client_for(stranger)
    assert client.get(f"/api/v1/tasks/{task.id}/").status_code == 200
    response = client.patch(f"/api/v1/tasks/{task.id}/", {"title": "Revisada"}, format="json")
    assert response.status_code == 200


# --- Eliminación -------------------------------------------------------------


def test_creator_can_delete_own_task(manager_client, manager, collaborator):
    task = _task(collaborator, manager)

    response = manager_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 204
    assert not Task.objects.filter(id=task.id).exists()


def test_leader_with_tareas_validar_can_delete_team_task(
    manager_client, manager, collaborator, stranger
):
    """En Nexo, `usuarios.editar` borraba cualquier tarea; aquí el líder con
    `tareas.validar` borra las de su equipo."""
    organigrama(manager, collaborator)
    task = _task(collaborator, stranger)

    response = manager_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 204


def test_leader_cannot_delete_task_outside_his_team(manager_client, collaborator, stranger):
    task = _task(collaborator, stranger)

    response = manager_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 404
    assert Task.objects.filter(id=task.id).exists()


def test_admin_can_delete_any_task_of_the_company(collaborator, stranger):
    admin = User.objects.create_user(
        username="admin_gh", email="admin_gh@example.com", password="Sup3r-Secr3t!"
    )
    set_role(admin, ADMIN_GH)
    task = _task(collaborator, stranger)

    response = client_for(admin).delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 204


def test_assignee_cannot_delete_task_created_by_someone_else(
    collaborator_client, collaborator, stranger
):
    task = _task(collaborator, stranger)

    response = collaborator_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 403
    assert Task.objects.filter(id=task.id).exists()


# --- Comentarios y has_unread_comments --------------------------------------


def test_posting_comment_and_unread_flag_for_other_participant(
    collaborator_client, manager_client, collaborator, manager
):
    task = _task(collaborator, manager)

    post_response = manager_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )
    assert post_response.status_code == 201
    assert Comment.objects.filter(task=task, text="Hola", author=manager).exists()

    list_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/")
    assert list_response.status_code == 200
    assert list_response.data["has_unread_comments"] is True

    view_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/comments/")
    assert view_response.status_code == 200
    assert TaskCommentView.objects.filter(task=task, user=collaborator).exists()

    after_view_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/")
    assert after_view_response.data["has_unread_comments"] is False


# --- Aviso al comentar: hacia arriba según el organigrama -------------------


def _analista_y_su_jefe(sufijo: str = ""):
    analista = User.objects.create_user(
        username=f"analista{sufijo}",
        email=f"analista{sufijo}@example.com",
        password="Sup3r-Secr3t!",
        first_name="Ana",
    )
    set_role(analista, "ANALISTA_CC")
    jefe = User.objects.create_user(
        username=f"coord{sufijo}", email=f"coord{sufijo}@example.com", password="Sup3r-Secr3t!"
    )
    set_role(jefe, "COORDINADOR_NACIONAL")
    organigrama(jefe, analista)
    return analista, jefe


def test_commenting_notifies_the_boss_in_the_organigrama():
    """En Nexo: ANALISTA_CC → COORDINADOR_NACIONAL (`RoleNotificationTarget`).
    Aquí: el jefe inmediato de quien comenta."""
    analista, coordinador = _analista_y_su_jefe()
    task = _task(analista, analista, title="Tarea con jerarquía")

    response = client_for(analista).post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "x" * 80}, format="json"
    )

    assert response.status_code == 201
    notification = notifications(coordinador).get()
    assert f'comentó en "{task.title}"' in notification.resumen
    assert notification.resumen.endswith("…")  # vista previa de 60 caracteres + «…»
    assert task_id_of(notification) == task.id
    assert notification.tipo == "tareas.comentario"


def test_commenting_notifies_the_boss_not_everyone_with_the_boss_role():
    """Lo que cambia frente a Nexo: otro Coordinador Nacional que no es su jefe
    en el organigrama no recibe el aviso."""
    analista, coordinador = _analista_y_su_jefe()
    otro = User.objects.create_user(
        username="otro_coord", email="otro_coord@example.com", password="Sup3r-Secr3t!"
    )
    set_role(otro, "COORDINADOR_NACIONAL")
    task = _task(analista, analista)

    client_for(analista).post(f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json")

    assert notifications(coordinador).count() == 1
    assert not notifications(otro).exists()


def test_vacant_boss_cargo_notifies_the_next_one_up():
    analista = User.objects.create_user(
        username="analista_v", email="analista_v@example.com", password="Sup3r-Secr3t!"
    )
    jefe_nacional = User.objects.create_user(
        username="jefe_v", email="jefe_v@example.com", password="Sup3r-Secr3t!"
    )
    from .conftest import cargo, poner_en_cargo

    arriba = cargo("Jefatura Nacional")
    vacante = cargo("Coordinación (vacante)", jefe=arriba)
    poner_en_cargo(jefe_nacional, arriba)
    poner_en_cargo(analista, cargo("Analista", jefe=vacante))
    task = _task(analista, analista)

    client_for(analista).post(f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json")

    assert notifications(jefe_nacional).count() == 1


def test_commenting_does_not_notify_without_a_boss(collaborator_client, collaborator):
    # Sin cargo en el organigrama no hay a quién avisar «hacia arriba».
    task = _task(collaborator, collaborator, title="Tarea sin jerarquía")

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )

    assert response.status_code == 201
    assert not notifications().exists()


def test_first_comment_role_notifies_only_on_the_first_comment(collaborator_client, collaborator):
    jefe = User.objects.create_user(
        username="jefe3", email="jefe3@example.com", password="Sup3r-Secr3t!"
    )
    set_role(jefe, "JEFE_NACIONAL")
    save_settings({"first_comment_role": "JEFE_NACIONAL"}, collaborator)
    task = _task(collaborator, collaborator, title="Tarea primer comentario")

    first = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Primero"}, format="json"
    )
    assert first.status_code == 201
    assert notifications(jefe).count() == 1

    second = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Segundo"}, format="json"
    )
    assert second.status_code == 201
    assert notifications(jefe).count() == 1  # sin nuevo aviso


def test_first_comment_role_and_boss_union_without_duplicate_notification():
    analista = User.objects.create_user(
        username="analista4", email="analista4@example.com", password="Sup3r-Secr3t!"
    )
    set_role(analista, "ANALISTA_CC")
    jefe = User.objects.create_user(
        username="jefe4", email="jefe4@example.com", password="Sup3r-Secr3t!"
    )
    set_role(jefe, "JEFE_NACIONAL")
    # El jefe es a la vez su jefe inmediato Y del rol del primer comentario.
    organigrama(jefe, analista)
    save_settings({"first_comment_role": "JEFE_NACIONAL"}, analista)
    task = _task(analista, analista, title="Tarea unión")

    response = client_for(analista).post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Primero"}, format="json"
    )

    assert response.status_code == 201
    assert notifications(jefe).count() == 1


def test_commenting_never_notifies_the_author_even_if_configured_to_target_own_role():
    analista = User.objects.create_user(
        username="analista3", email="analista3@example.com", password="Sup3r-Secr3t!"
    )
    set_role(analista, "ANALISTA_CC")
    save_settings({"first_comment_role": "ANALISTA_CC"}, analista)
    task = _task(analista, analista, title="Tarea auto-notificación")

    response = client_for(analista).post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )

    assert response.status_code == 201
    assert not notifications().exists()
