"""Servicios de la papelera (`recovery.py`), portado de Nexo
(`apps/recovery/tests/test_recovery_services.py`).

Quedan fuera las pruebas de las notas del Escritorio Digital (`DESK_NOTE`):
ese módulo no se porta. La bitácora `RecoveryAuditLog` de Nexo es aquí la
auditoría común (`AuditLog`)."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.models import AuditLog
from apps.novedades.configuracion import set_config_value
from apps.projects.models import Project, RecoveryItem
from apps.projects.recovery import (
    CONFIG_KEY_RECOVERY_RETENTION_HOURS,
    ENTITY_REGISTRY,
    RecoveryError,
    delete_permanently,
    get_remaining_retention_time,
    list_active_trash,
    move_to_trash,
    purge_expired_items,
    restore,
)

from .conftest import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return make_user("u")


@pytest.fixture
def project(user):
    now = timezone.now()
    return Project.objects.create(
        name="Proyecto",
        priority="MEDIA",
        start_date=now,
        target_date=now + timedelta(days=30),
        target_time_hours=10,
        responsible=user,
        created_by=user,
    )


def _audits(operation: str):
    return AuditLog.objects.filter(action=f"proyectos_gh.papelera.{operation}")


# --- move_to_trash -----------------------------------------------------------


def test_move_to_trash_unregistered_entity_type_raises(user):
    with pytest.raises(RecoveryError):
        move_to_trash(entity_type="DESCONOCIDO", entity_id="1", user=user)


def test_move_to_trash_creates_item_and_sets_local_flag(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    project.refresh_from_db()
    assert project.deleted_at is not None
    assert item.status == RecoveryItem.Status.ACTIVE
    assert item.entity_label == "Proyecto"
    assert item.module_label == "Proyectos"
    assert item.retention_hours == 48
    assert item.expires_at == item.deleted_at + timedelta(hours=48)
    assert item.empresa_id == project.empresa_id
    assert _audits("move_to_trash").count() == 1


def test_retention_is_a_setting(user, project):
    set_config_value(CONFIG_KEY_RECOVERY_RETENTION_HOURS, "72", user)
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    assert item.retention_hours == 72


def test_move_to_trash_already_active_raises(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    with pytest.raises(RecoveryError):
        move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)


# --- restore -------------------------------------------------------------------


def test_restore_not_in_trash_raises(user, project):
    with pytest.raises(RecoveryError):
        restore(entity_type="PROJECT", entity_id=str(project.id), user=user)


def test_restore_expired_raises(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    RecoveryItem.objects.filter(pk=item.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
    with pytest.raises(RecoveryError):
        restore(entity_type="PROJECT", entity_id=str(project.id), user=user)


def test_restore_clears_local_flag_and_marks_restored(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    item = restore(entity_type="PROJECT", entity_id=str(project.id), user=user)
    project.refresh_from_db()
    assert project.deleted_at is None
    assert item.status == RecoveryItem.Status.RESTORED
    assert item.restored_by_id == user.id
    assert _audits("restore").count() == 1


# --- delete_permanently ------------------------------------------------------------


def test_delete_permanently_not_in_trash_raises(user, project):
    with pytest.raises(RecoveryError):
        delete_permanently(entity_type="PROJECT", entity_id=str(project.id), user=user)


def test_delete_permanently_hard_deletes_and_marks_purged(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    delete_permanently(entity_type="PROJECT", entity_id=str(project.id), user=user)
    item.refresh_from_db()
    assert not Project.objects.filter(pk=project.id).exists()
    assert item.status == RecoveryItem.Status.PURGED
    assert item.purge_origin == RecoveryItem.Origin.MANUAL
    assert item.purged_by_id == user.id
    assert _audits("delete_permanently").count() == 1


# --- purge_expired_items -----------------------------------------------------------


def test_purge_expired_items_ignores_non_expired(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    assert purge_expired_items() == {"purged": 0}
    assert Project.objects.filter(pk=project.id).exists()


def test_purge_expired_items_hard_deletes_expired_and_audits_with_no_user(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    RecoveryItem.objects.filter(pk=item.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
    assert purge_expired_items() == {"purged": 1}
    item.refresh_from_db()
    assert item.status == RecoveryItem.Status.PURGED
    assert item.purge_origin == RecoveryItem.Origin.AUTOMATIC
    assert not Project.objects.filter(pk=project.id).exists()
    evento = _audits("purge_expired").get()
    assert evento.actor_id is None


def test_purge_expired_items_skips_unregistered_entity_type_without_error(user, monkeypatch):
    now = timezone.now()
    RecoveryItem.objects.create(
        entity_type="RETIRADO",
        entity_id="1",
        module_label="Retirado",
        deleted_by=user,
        deleted_at=now - timedelta(days=3),
        retention_hours=1,
        expires_at=now - timedelta(days=2),
    )
    assert "RETIRADO" not in ENTITY_REGISTRY
    assert purge_expired_items() == {"purged": 0}
    assert RecoveryItem.objects.get(entity_type="RETIRADO").status == RecoveryItem.Status.ACTIVE


# --- get_remaining_retention_time / list_active_trash ------------------------------


def test_get_remaining_retention_time_none_when_not_trashed(project):
    assert get_remaining_retention_time("PROJECT", str(project.id)) is None


def test_get_remaining_retention_time_reflects_expires_at(user, project):
    item = move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    remaining = get_remaining_retention_time("PROJECT", str(project.id))
    assert remaining["expires_at"] == item.expires_at
    assert 0 < remaining["ms_remaining"] <= 48 * 3600 * 1000


def test_list_active_trash_scoped_to_entity_type(user, project):
    move_to_trash(entity_type="PROJECT", entity_id=str(project.id), user=user)
    assert [i.entity_id for i in list_active_trash("PROJECT")] == [str(project.id)]
    assert list(list_active_trash("DESK_NOTE")) == []
