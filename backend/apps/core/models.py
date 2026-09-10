from django.conf import settings
from django.db import models


class BaseModel(models.Model):
    """Modelo abstracto reutilizable con campos de auditoría temporal."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class AuditLog(BaseModel):
    """Bitácora genérica de auditoría, reutilizable por cualquier módulo.

    No referencia un modelo concreto por FK (evita acoplar `apps.core` a
    otras apps): `target_type`/`target_id` identifican el objeto afectado
    como texto. `previous_values`/`new_values` separan explícitamente el
    antes y el después; ambos pasan por
    `apps.core.sensitive_data.mask_sensitive_fields` antes de guardarse —
    nunca contraseñas, tokens ni secretos en texto plano (ver
    `apps.core.audit.record_audit_event`).

    Registro *append-only*: no hay endpoint de escritura/edición/borrado (ver
    `apps.core.audit_views.AuditLogViewSet`, de solo lectura) — la integridad
    del historial es una propiedad estructural, no una convención.
    """

    class Result(models.TextChoices):
        SUCCESS = "success", "Éxito"
        FAILURE = "failure", "Fallido"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_actions",
    )
    action = models.CharField(max_length=100, db_index=True)
    module = models.CharField(max_length=50, blank=True, db_index=True)
    target_type = models.CharField(max_length=100)
    target_id = models.CharField(max_length=64)
    previous_values = models.JSONField(default=dict, blank=True)
    new_values = models.JSONField(default=dict, blank=True)
    result = models.CharField(max_length=10, choices=Result.choices, default=Result.SUCCESS)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    browser = models.CharField(max_length=50, blank=True)
    operating_system = models.CharField(max_length=50, blank=True)
    device = models.CharField(max_length=50, blank=True)
    # Ubicación aproximada: sin resolver en esta base (no integra un
    # proveedor de geo-IP ni un flujo de consentimiento) — el campo existe
    # para que un proyecto concreto lo complete; ver docs/architecture.md.
    location = models.CharField(max_length=255, blank=True)
    correlation_id = models.CharField(max_length=64, blank=True, db_index=True)
    #: En qué empresa ocurrió. Nula para lo que no pertenece a ninguna —iniciar
    #: sesión, cambiar el tema, administrar las propias empresas—, que solo ve
    #: el superusuario.
    #:
    #: Es columna propia y no una ruta hasta el objeto afectado porque el
    #: registro sobrevive a lo que describe: un activo dado de baja y borrado
    #: deja su evento, y entonces no habría por dónde preguntar de quién era.
    empresa = models.ForeignKey(
        "empresas.Empresa",
        on_delete=models.PROTECT,
        related_name="eventos_auditoria",
        null=True,
        blank=True,
        db_index=True,
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["target_type", "target_id"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.action} sobre {self.target_type}:{self.target_id}"
