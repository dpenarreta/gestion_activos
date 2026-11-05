"""La papelera de Proyectos (de Nexo, `apps.recovery`, el «Centro de
Recuperación»).

En Nexo era transversal (Proyectos y notas del Escritorio Digital) con un
registro de adaptadores por tipo de entidad. Aquí solo la usa Proyectos, así
que vive en esta app, con el mismo diseño (`ENTITY_REGISTRY`) por si otro
módulo la necesita mañana. Diferencias:

- Cada fila es de una empresa (`RecoveryItem` hereda de `ModeloDeEmpresa`):
  abrir la papelera purga solo lo vencido de la empresa activa.
- Su bitácora (`RecoveryAuditLog` de Nexo) es la auditoría común
  (`record_audit_event`, módulo `proyectos_gh`).
- El plazo de retención es un ajuste con vigencia de Gestión Humana
  (`novedades.SettingHistory`, clave `recovery_center_retention_hours`, 48 h
  por defecto, como en Nexo).
- Al eliminar un proyecto para siempre se borran también los archivos de sus
  documentos, después de confirmar la transacción.
"""

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Callable

from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from apps.core.audit import record_audit_event
from apps.novedades.configuracion import get_effective_config_value
from apps.tasks.rounding import round_half_up

from .models import Project, ProjectDocument, RecoveryItem

logger = logging.getLogger(__name__)

AUDIT_MODULE = "proyectos_gh"

CONFIG_KEY_RECOVERY_RETENTION_HOURS = "recovery_center_retention_hours"
DEFAULT_RECOVERY_RETENTION_HOURS = 48

PROJECT = "PROJECT"


class RecoveryError(Exception):
    """Error curado de la papelera: el mensaje ya está pensado para mostrarse
    (la vista lo traduce a 409)."""


@dataclass(frozen=True)
class EntityAdapter:
    module_label: str
    get_display_name: Callable[[str], str | None]
    set_trashed: Callable[[str, bool], None]
    hard_delete: Callable[[str], None]


def get_effective_recovery_retention_hours(as_of) -> int:
    value = get_effective_config_value(
        CONFIG_KEY_RECOVERY_RETENTION_HOURS, as_of, DEFAULT_RECOVERY_RETENTION_HOURS
    )
    return max(int(value), 1)


def _project_get_display_name(entity_id: str) -> str | None:
    project = Project.objects.filter(pk=entity_id).only("name").first()
    return project.name if project else None


def _project_set_trashed(entity_id: str, trashed: bool) -> None:
    Project.objects.filter(pk=entity_id).update(deleted_at=timezone.now() if trashed else None)


def _delete_files_later(names: list[str]) -> None:
    """Los archivos se borran después de confirmar: si la transacción se
    revierte, el proyecto sigue y sus documentos también."""
    if not names:
        return

    def borrar():
        for name in names:
            try:
                default_storage.delete(name)
            except Exception:  # noqa: BLE001 — un archivo que no se borra no tumba la purga
                logger.exception("No se pudo borrar el archivo de un documento de proyecto")

    transaction.on_commit(borrar)


def _project_hard_delete(entity_id: str) -> None:
    names = [
        name
        for name in ProjectDocument.objects.filter(project_id=entity_id).values_list(
            "file", flat=True
        )
        if name
    ]
    Project.objects.filter(pk=entity_id).delete()
    _delete_files_later(names)


ENTITY_REGISTRY: dict[str, EntityAdapter] = {
    PROJECT: EntityAdapter(
        module_label="Proyectos",
        get_display_name=_project_get_display_name,
        set_trashed=_project_set_trashed,
        hard_delete=_project_hard_delete,
    ),
}


def _get_adapter(entity_type: str) -> EntityAdapter:
    adapter = ENTITY_REGISTRY.get(entity_type)
    if adapter is None:
        raise RecoveryError(f"Tipo de entidad no registrada en la papelera: {entity_type}")
    return adapter


def register_audit_event(
    *, entity_type: str, entity_id: str, user, operation: str, origin: str, context=None
) -> None:
    """Un evento de auditoría por operación (en Nexo, `RecoveryAuditLog`)."""
    record_audit_event(
        actor=user,
        action=f"proyectos_gh.papelera.{operation.lower()}",
        target_type=entity_type.lower(),
        target_id=entity_id,
        module=AUDIT_MODULE,
        new_values={"operacion": operation, "origen": origin},
        context=context,
    )


def _active_item(entity_type: str, entity_id: str) -> RecoveryItem | None:
    return (
        RecoveryItem.objects.filter(
            entity_type=entity_type, entity_id=entity_id, status=RecoveryItem.Status.ACTIVE
        )
        .order_by("-deleted_at", "-id")
        .first()
    )


def move_to_trash(*, entity_type: str, entity_id: str, user, context=None) -> RecoveryItem:
    adapter = _get_adapter(entity_type)
    if _active_item(entity_type, entity_id) is not None:
        raise RecoveryError("Este elemento ya está en la papelera")

    deleted_at = timezone.now()
    retention_hours = get_effective_recovery_retention_hours(deleted_at)
    with transaction.atomic():
        item = RecoveryItem.objects.create(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=adapter.get_display_name(entity_id),
            module_label=adapter.module_label,
            status=RecoveryItem.Status.ACTIVE,
            deleted_by=user,
            deleted_at=deleted_at,
            retention_hours=retention_hours,
            expires_at=deleted_at + timedelta(hours=retention_hours),
        )
        adapter.set_trashed(entity_id, True)
        register_audit_event(
            entity_type=entity_type,
            entity_id=entity_id,
            user=user,
            operation="MOVE_TO_TRASH",
            origin=RecoveryItem.Origin.MANUAL,
            context=context,
        )
    return item


def restore(*, entity_type: str, entity_id: str, user, context=None) -> RecoveryItem:
    adapter = _get_adapter(entity_type)
    item = _active_item(entity_type, entity_id)
    if item is None:
        raise RecoveryError("Este elemento no está en la papelera")
    if item.expires_at <= timezone.now():
        raise RecoveryError("El período de retención de este elemento ya expiró")

    with transaction.atomic():
        item.status = RecoveryItem.Status.RESTORED
        item.restored_at = timezone.now()
        item.restored_by = user
        item.save(update_fields=["status", "restored_at", "restored_by", "updated_at"])
        adapter.set_trashed(entity_id, False)
        register_audit_event(
            entity_type=entity_type,
            entity_id=entity_id,
            user=user,
            operation="RESTORE",
            origin=RecoveryItem.Origin.MANUAL,
            context=context,
        )
    return item


def delete_permanently(*, entity_type: str, entity_id: str, user, context=None) -> None:
    adapter = _get_adapter(entity_type)
    item = _active_item(entity_type, entity_id)
    if item is None:
        raise RecoveryError("Este elemento no está en la papelera")

    with transaction.atomic():
        adapter.hard_delete(entity_id)
        item.status = RecoveryItem.Status.PURGED
        item.purged_at = timezone.now()
        item.purged_by = user
        item.purge_origin = RecoveryItem.Origin.MANUAL
        item.save(update_fields=["status", "purged_at", "purged_by", "purge_origin", "updated_at"])
        register_audit_event(
            entity_type=entity_type,
            entity_id=entity_id,
            user=user,
            operation="DELETE_PERMANENTLY",
            origin=RecoveryItem.Origin.MANUAL,
            context=context,
        )


def purge_expired_items() -> dict:
    """Purga lo vencido de la empresa activa. Perezosa, como en Nexo: corre
    cada vez que se abre la papelera. Idempotente."""
    expired = list(
        RecoveryItem.objects.filter(
            status=RecoveryItem.Status.ACTIVE, expires_at__lte=timezone.now()
        )
    )
    purged = 0
    for item in expired:
        adapter = ENTITY_REGISTRY.get(item.entity_type)
        if adapter is None:
            # Tipo desregistrado: se deja para revisión manual.
            continue
        with transaction.atomic():
            adapter.hard_delete(item.entity_id)
            item.status = RecoveryItem.Status.PURGED
            item.purged_at = timezone.now()
            item.purge_origin = RecoveryItem.Origin.AUTOMATIC
            item.save(update_fields=["status", "purged_at", "purge_origin", "updated_at"])
            register_audit_event(
                entity_type=item.entity_type,
                entity_id=item.entity_id,
                user=None,
                operation="PURGE_EXPIRED",
                origin=RecoveryItem.Origin.AUTOMATIC,
            )
        purged += 1
    return {"purged": purged}


def get_remaining_retention_time(entity_type: str, entity_id: str) -> dict | None:
    item = _active_item(entity_type, entity_id)
    if item is None:
        return None
    remaining = (item.expires_at - timezone.now()).total_seconds() * 1000
    return {"expires_at": item.expires_at, "ms_remaining": max(0, round_half_up(remaining))}


def list_active_trash(entity_type: str):
    return RecoveryItem.objects.filter(
        entity_type=entity_type, status=RecoveryItem.Status.ACTIVE
    ).order_by("-deleted_at")
