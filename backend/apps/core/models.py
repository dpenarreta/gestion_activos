import datetime

from django.conf import settings
from django.core.exceptions import ValidationError
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


class PoliticaDeRespaldo(models.Model):
    """Cuándo se respalda solo, y dónde queda.

    **La frecuencia vive aquí y no en el programador de tareas**, por lo mismo
    que la del resumen de alertas: el programador es infraestructura —quien
    decide cada cuánto hay que respaldar no tiene acceso a él, y cambiar
    «semanal» por «diaria» no debería necesitar un administrador de servidores—.
    La tarea del sistema corre cada hora, siempre igual, y esto decide si toca.

    Es una sola fila para todo el despliegue, no una por empresa: lo que se
    respalda es la base entera, y una base no se puede respaldar «solo la parte
    de LaarCourier».
    """

    class Frecuencia(models.TextChoices):
        DIARIA = "diaria", "Diaria"
        SEMANAL = "semanal", "Semanal"

    activo = models.BooleanField(
        default=False,
        help_text="Si el respaldo automático está encendido.",
    )
    frecuencia = models.CharField(
        max_length=10, choices=Frecuencia.choices, default=Frecuencia.DIARIA
    )
    #: `weekday()` de Python: lunes es 0. El número y no el nombre, para no
    #: depender del idioma con el que se configuró el sistema.
    dia_semanal = models.PositiveSmallIntegerField(
        default=0,
        help_text="Día de la semana, cuando la frecuencia es semanal (0 = lunes).",
    )
    hora = models.TimeField(
        default=datetime.time(2, 0),
        help_text=(
            "A partir de qué hora del día se respalda. De madrugada, mientras "
            "nadie trabaja: un respaldo es lento y bloquea."
        ),
    )
    destino = models.CharField(
        max_length=255,
        default="respaldos",
        help_text=(
            "Carpeta donde se guardan los adjuntos y el manifiesto. Conviene "
            "que esté fuera de esta máquina: un respaldo que vive junto a lo "
            "que protege no protege de perderla."
        ),
    )
    conservar = models.PositiveSmallIntegerField(
        default=14,
        help_text=(
            "Cuántos respaldos se guardan. Los más viejos se borran al hacer "
            "uno nuevo: sin esto, el disco se llena y el respaldo empieza a "
            "fallar justo cuando más falta hace."
        ),
    )
    #: La fecha del último respaldo **automático**. Uno hecho a mano no cuenta
    #: aquí: si contara, lanzar uno de prueba un martes saltaría el programado
    #: del miércoles sin que nadie lo notara.
    ultimo_respaldo = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name = "política de respaldo"
        verbose_name_plural = "política de respaldo"

    def __str__(self) -> str:
        if not self.activo:
            return "Respaldo automático apagado"
        return f"Respaldo {self.get_frecuencia_display().lower()} a las {self.hora:%H:%M}"

    @classmethod
    def vigente(cls):
        """La única fila, creándola con los valores por defecto si no existe."""
        politica = cls.objects.first()
        if politica is None:
            politica = cls.objects.create()
        return politica

    def clean(self):
        if self.conservar < 1:
            raise ValidationError(
                {"conservar": "Hay que conservar al menos uno: cero sería no respaldar."}
            )
        if not 0 <= self.dia_semanal <= 6:
            raise ValidationError({"dia_semanal": "El día va de 0 (lunes) a 6 (domingo)."})

    def toca_respaldar(self, ahora) -> bool:
        """Si corresponde respaldar en este momento.

        Tres condiciones, y las tres importan: que esté encendido, que hoy sea
        el día y que ya haya pasado la hora. Lo que evita el respaldo repetido
        no es el reloj sino `ultimo_respaldo`: la tarea corre cada hora, y sin
        esa marca haría uno por hora desde las dos de la mañana.
        """
        if not self.activo:
            return False
        hoy = ahora.date()
        if self.ultimo_respaldo == hoy:
            return False
        if self.frecuencia == self.Frecuencia.SEMANAL and hoy.weekday() != self.dia_semanal:
            return False
        return ahora.time() >= self.hora
