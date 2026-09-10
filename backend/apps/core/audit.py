"""Registro de eventos de auditoría, reutilizable por cualquier módulo.

Único punto de entrada al modelo `AuditLog` — ningún llamador escribe ahí
directamente, así que el enmascarado de datos sensibles
(`apps.core.sensitive_data.mask_sensitive_fields`) se aplica siempre, sin
depender de que cada `services.py` se acuerde de hacerlo.
"""

from .models import AuditLog
from .sensitive_data import mask_sensitive_fields


def record_audit_event(
    *,
    actor,
    action: str,
    target=None,
    target_type: str | None = None,
    target_id: str | int | None = None,
    module: str = "",
    previous_values: dict | None = None,
    new_values: dict | None = None,
    result: str = AuditLog.Result.SUCCESS,
    context: dict | None = None,
) -> AuditLog:
    """Registra un evento. `target` infiere `target_type`/`target_id` del
    objeto (`__class__.__name__`, `pk`); pásalos explícitos en su lugar
    cuando el objeto ya no exista (ej. tras eliminarlo). `context` es el
    dict de `apps.core.request_meta.get_request_context(request)` — IP,
    user-agent, navegador/SO/dispositivo y correlation id."""
    if target is not None:
        target_type = target.__class__.__name__.lower()
        target_id = target.pk

    context = context or {}

    # La empresa se toma del contexto de la petición, no de quien llama: son
    # más de treinta sitios los que registran eventos y bastaría con que uno se
    # olvidara para que su rastro fuera legible desde la otra empresa.
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    if empresa is SIN_EMPRESA:
        empresa = None

    return AuditLog.objects.create(
        empresa=empresa,
        actor=actor,
        action=action,
        module=module,
        target_type=target_type or "",
        target_id=str(target_id) if target_id is not None else "",
        previous_values=mask_sensitive_fields(previous_values),
        new_values=mask_sensitive_fields(new_values),
        result=result,
        ip_address=context.get("ip_address"),
        user_agent=context.get("user_agent", ""),
        browser=context.get("browser", ""),
        operating_system=context.get("operating_system", ""),
        device=context.get("device", ""),
        correlation_id=context.get("correlation_id", ""),
    )
