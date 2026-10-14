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


#: Lunes es 0, como `weekday()` de Python. El número y no el nombre, para no
#: depender del idioma con el que se configuró el sistema.
TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6]

#: Tope de horas por día. No es un límite técnico: un respaldo completo lleva
#: minutos y bloquea, y pasado este número lo que se busca es otra cosa —una
#: réplica de la base—, no más copias.
MAXIMO_HORAS = 8


def _dias_por_defecto():
    return list(TODOS_LOS_DIAS)


def _horas_por_defecto():
    # Al final de la jornada y no de madrugada: un respaldo programado para
    # cuando el equipo está apagado no se hace, y en esta instalación el equipo
    # que lo corre es de oficina.
    return ["17:00"]


class PoliticaDeRespaldo(models.Model):
    """Cuándo se respalda solo, y dónde queda.

    **El cuándo vive aquí y no en el programador de tareas**, por lo mismo que
    la frecuencia del resumen de alertas: el programador es infraestructura
    —quien decide cuándo hay que respaldar no tiene acceso a él—, y cambiar la
    hora o los días no debería necesitar un administrador de servidores. La
    tarea del sistema corre cada pocos minutos, siempre igual, y esto decide si
    toca.

    Se configura como un horario: **qué días** de la semana y **a qué horas**
    de cada uno de esos días. «Diario a las 02:00» son los siete días con una
    hora; «de lunes a viernes a las 13:00 y a las 22:00», cinco días con dos.

    Es una sola fila para todo el despliegue, no una por empresa: lo que se
    respalda es la base entera, y una base no se puede respaldar «solo la parte
    de LaarCourier».
    """

    #: Encendido de fábrica: un sistema recién instalado sin respaldo no avisa
    #: de nada hasta el día que hace falta volver a algún sitio.
    activo = models.BooleanField(
        default=True,
        help_text="Si el respaldo automático está encendido.",
    )
    dias = models.JSONField(
        default=_dias_por_defecto,
        help_text="Días de la semana en que se respalda (0 = lunes … 6 = domingo).",
    )
    horas = models.JSONField(
        default=_horas_por_defecto,
        help_text=(
            "Horas del día, en hora local y formato HH:MM. Mejor fuera del "
            "horario de trabajo: un respaldo es lento y bloquea."
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
    #: El último turno del horario que quedó cubierto —la fecha y hora
    #: programadas, no la de ejecución—. Es lo que evita repetirlo: la tarea
    #: pasa varias veces después de cada turno. Uno hecho a mano desde la
    #: terminal no cuenta aquí: si contara, lanzar uno de prueba un martes
    #: saltaría el programado sin que nadie lo notara.
    ultimo_programado = models.DateTimeField(null=True, blank=True)
    #: «Respaldar ahora» desde la pantalla. La petición web no respalda: un
    #: respaldo tarda minutos y bloquea, y una petición que espera tanto acaba
    #: cortada por el navegador o el proxy con el respaldo a medias. Deja la
    #: orden aquí y la tarea la cumple en su siguiente pasada.
    solicitado_en = models.DateTimeField(null=True, blank=True)
    solicitado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    #: Cómo terminó la última vez que la tarea respaldó. Sin esto, un respaldo
    #: que falla todas las noches —Docker apagado, disco lleno— solo deja
    #: rastro en una salida que nadie mira.
    ultima_ejecucion = models.DateTimeField(null=True, blank=True)
    ultimo_error = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "política de respaldo"
        verbose_name_plural = "política de respaldo"

    def __str__(self) -> str:
        if not self.activo:
            return "Respaldo automático apagado"
        return f"Respaldo a las {', '.join(self.horas_ordenadas())}"

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

    # --- El horario ---

    def horas_ordenadas(self) -> list[str]:
        return sorted(set(self.horas or []))

    def _turnos_del_dia(self, dia: datetime.date) -> list[datetime.datetime]:
        """Los momentos programados de un día, en la zona del sistema."""
        from django.utils import timezone

        if dia.weekday() not in (self.dias or []):
            return []
        return [
            timezone.make_aware(datetime.datetime.combine(dia, datetime.time.fromisoformat(hora)))
            for hora in self.horas_ordenadas()
        ]

    def turno_pendiente(self, ahora):
        """El turno que corresponde cubrir ahora, o `None`.

        Es el último turno de hoy que ya pasó, si no se cubrió todavía. Solo el
        último: si el equipo estuvo apagado a las 13:00 y a las 22:00, al
        encenderse se hace **un** respaldo, no dos seguidos con el mismo
        contenido. Tampoco se recuperan turnos de días anteriores: al día
        siguiente ya hay uno nuevo que cubre lo mismo y más.
        """
        if not self.activo:
            return None
        pasados = [turno for turno in self._turnos_del_dia(ahora.date()) if turno <= ahora]
        if not pasados:
            return None
        turno = pasados[-1]
        if self.ultimo_programado and self.ultimo_programado >= turno:
            return None
        return turno

    def toca_respaldar(self, ahora) -> bool:
        return self.turno_pendiente(ahora) is not None

    def proximo_turno(self, ahora):
        """Cuándo le toca: el pendiente si lo hay, si no el siguiente del
        horario. `None` si está apagado o el horario está vacío."""
        if not self.activo:
            return None
        pendiente = self.turno_pendiente(ahora)
        if pendiente is not None:
            return pendiente
        for dentro_de in range(0, 8):
            dia = ahora.date() + datetime.timedelta(days=dentro_de)
            for turno in self._turnos_del_dia(dia):
                if turno > ahora:
                    return turno
        return None
