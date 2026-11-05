"""Ausencias de Gestión Humana: permisos y estados especiales (fase 2b,
05/11/2026), portados de `apps.configuration` de Nexo.

Son la base horaria del motor de KPI: un permiso descuenta horas de la base
del día y un estado especial (maternidad, lactancia) cambia la base y los
límites de ese día. Se conservan los nombres de Nexo para portar sus pruebas
y migrar sus datos.

**Datos de salud (LOPDP).** Un `LeaveRecord` de tipo MEDICO y un
`SpecialStatus` (maternidad, lactancia) son datos de salud. Quién los ve con
su detalle y cómo se enmascaran para los demás está en `access.py`; ni los
avisos ni la auditoría llevan el tipo ni la observación.

Viven en su propia app (no en `apps.tasks`) porque son su propio límite de
datos sensibles —con su bloque de permisos, `ausencias.*`— y porque los
consumen el KPI y, más adelante, la Solicitud de permisos (`apps.licencias`),
no Tareas.
"""

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


class LeaveRecord(ModeloDeEmpresa):
    """Un permiso o ausencia de un día. Un rango se registra como una fila por
    día laborable (como en Nexo).

    **Desde una solicitud (05/11/2026).** Al aprobarse una Solicitud de
    permisos (`apps.licencias`) se crean sus registros con `solicitud` y el
    `descuento` de su tipo de permiso; no se editan ni se borran desde aquí
    (409): se gestionan desde la solicitud, y si se cancela se borran. Los
    registros manuales tienen `solicitud` y `descuento` en nulo."""

    class Descuento(models.TextChoices):
        # Los mismos valores que `licencias.FlujoPermiso.Descuento`.
        SUELDO = "sueldo", "Con descuento de sueldo"
        VACACIONES = "vacaciones", "Se descuenta de las vacaciones"
        NINGUNO = "ninguno", "Con goce de sueldo (sin descuento)"

    class Type(models.TextChoices):
        MEDICO = "MEDICO", "Médico"
        PERSONAL = "PERSONAL", "Personal"
        VACACIONES = "VACACIONES", "Vacaciones"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="leave_records", on_delete=models.CASCADE
    )
    type = models.CharField(max_length=15, choices=Type.choices)
    date = models.DateField()
    is_full_day = models.BooleanField()
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    observation = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )
    #: La solicitud aprobada de la que viene (nulo si se registró a mano).
    solicitud = models.ForeignKey(
        "licencias.SolicitudPermiso",
        related_name="ausencias",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
    )
    #: El `descuento` del tipo de permiso de la solicitud (nulo si es manual).
    descuento = models.CharField(max_length=10, choices=Descuento.choices, null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["empresa", "user", "date"]),
            # La purga de retención (`purge_expired_medical_leaves`) corre
            # cada 5 minutos: sin nada vencido, es un `exists()` sobre este.
            models.Index(fields=["type", "date"], name="ausencias_tipo_fecha_idx"),
        ]
        constraints = [
            # Idempotencia: aprobar dos veces o reintentar no duplica.
            models.UniqueConstraint(
                fields=["solicitud", "date"],
                condition=models.Q(solicitud__isnull=False),
                name="ausencia_unica_por_solicitud_y_dia",
            )
        ]

    def __str__(self) -> str:
        # Sin el tipo: un `str()` termina en logs y en el admin.
        return f"Ausencia {self.pk} de {self.user_id} ({self.date})"


class SpecialStatus(ModeloDeEmpresa):
    """Estado especial (maternidad, lactancia): mientras rige, la base y los
    límites de KPI de esa persona son los de aquí, no los generales."""

    class Type(models.TextChoices):
        MATERNIDAD = "MATERNIDAD", "Maternidad"
        LACTANCIA = "LACTANCIA", "Lactancia"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="special_statuses", on_delete=models.CASCADE
    )
    type = models.CharField(max_length=15, choices=Type.choices)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    #: Base de horas diarias (objetivo y denominador del %).
    daily_hours = models.FloatField(default=6)
    limit_low = models.FloatField(default=5)
    #: Umbral real Moderado/Óptimo, independiente de `daily_hours`.
    limit_base = models.FloatField(default=6)
    limit_high = models.FloatField(default=7)
    limit_overload = models.FloatField(default=8)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT
    )

    class Meta:
        ordering = ["-start_date", "-id"]
        indexes = [models.Index(fields=["empresa", "user", "start_date"])]

    def __str__(self) -> str:
        return f"Estado especial {self.pk} de {self.user_id}"
