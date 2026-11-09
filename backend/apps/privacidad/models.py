"""Solicitudes de derechos sobre datos personales (LOPDP de Ecuador), portadas
de `apps.data_requests` de Nexo (`DataSubjectRequest`, 09/11/2026) y ampliadas
a toda la intranet: cualquier persona con cuenta las pide desde «Mi perfil» y
cubren lo que la intranet guarda de ella en todos los módulos.

Dos modelos:

- `SolicitudDerechos`: la solicitud, con su tipo, su estado, la fecha límite
  para responderla, quién la resolvió y cuándo, y la última respuesta al
  titular.
- `MovimientoSolicitud`: cada cambio de estado con su respuesta u observación
  al titular. Append-only: es la constancia de cómo y cuándo se le respondió.

Lo que cambia frente a Nexo:

- **Multiempresa.** La solicitud hereda de `ModeloDeEmpresa`: se dirige a la
  empresa en la que la persona está trabajando cuando la pide. Cada empresa del
  grupo es un responsable del tratamiento distinto (su propio RUC), y lo que la
  intranet guarda de la persona en una empresa lo atiende quien tiene el permiso
  en esa empresa. Quien trabaja en varias pide una en cada una (ver
  `docs/derechos-sobre-datos.md`). El movimiento cuelga de la solicitud.
- **Fecha límite.** Se calcula al crearla con el plazo vigente
  (`settings.PRIVACIDAD_PLAZO_DIAS`) y se guarda: si el plazo se cambia
  mañana, las solicitudes ya recibidas conservan el que se les comunicó.
- **RECHAZADA.** Nexo solo tenía PENDIENTE, EN_PROCESO y RESUELTA. Una
  eliminación puede no proceder (hay datos que la empresa debe conservar por
  ley: el rol de pagos, la auditoría); responderla «resuelta» confundiría al
  titular, y la LOPDP pide motivar la negativa. Por eso existe y exige
  respuesta.
- **Respuesta al titular.** Nexo solo cambiaba el estado; aquí cada cierre
  lleva el texto que lee el titular.
- **Nada irreversible automático.** Como en Nexo, una ELIMINACION no borra
  nada: quien atiende la gestiona a mano (baja lógica de la cuenta, depuración
  puntual) y deja constancia en la respuesta.
- **`on_delete`.** El titular es `PROTECT` (en Nexo, CASCADE): las cuentas de
  la intranet no se borran (baja lógica), y una solicitud es la constancia de
  que se ejerció un derecho; no debe desaparecer con nadie.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa

DESCRIPCION_MAX = 2000
RESPUESTA_MAX = 4000


class SolicitudDerechos(ModeloDeEmpresa):
    class Tipo(models.TextChoices):
        ACCESO = "ACCESO", "Acceso a mis datos"
        RECTIFICACION = "RECTIFICACION", "Corrección de datos"
        ELIMINACION = "ELIMINACION", "Eliminación de datos"

    class Estado(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        EN_PROCESO = "EN_PROCESO", "En proceso"
        RESUELTA = "RESUELTA", "Resuelta"
        RECHAZADA = "RECHAZADA", "Rechazada"

    #: Los estados en los que la solicitud ya tiene respuesta.
    FINALES = (Estado.RESUELTA, Estado.RECHAZADA)

    titular = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="solicitudes_de_derechos", on_delete=models.PROTECT
    )
    tipo = models.CharField(max_length=20, choices=Tipo.choices)
    descripcion = models.TextField(blank=True, default="")
    estado = models.CharField(max_length=15, choices=Estado.choices, default=Estado.PENDIENTE)
    #: Hasta cuándo hay para responder (fin de ese día, hora de Ecuador).
    fecha_limite = models.DateField()
    #: Los días del plazo con que se calculó `fecha_limite`.
    plazo_dias = models.PositiveSmallIntegerField()
    #: La última respuesta u observación al titular (la de cada cambio está en
    #: el historial).
    respuesta = models.TextField(blank=True, default="")
    resuelta_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="+",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
    )
    resuelta_en = models.DateTimeField(null=True, blank=True)
    #: El id que tenía en Nexo, si vino de allí (`importar_nexo_privacidad`).
    #: Evita importarla dos veces.
    id_nexo = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["empresa", "estado", "fecha_limite"]),
            models.Index(fields=["titular", "created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "id_nexo"],
                condition=models.Q(id_nexo__isnull=False),
                name="privacidad_una_por_id_de_nexo",
            )
        ]

    def __str__(self) -> str:
        # Sin la descripción: un `str()` termina en logs y en el admin.
        return f"Solicitud {self.pk} ({self.tipo})"

    @property
    def numero(self) -> str:
        return f"LOPDP-{self.pk:05d}" if self.pk else ""

    @property
    def cerrada(self) -> bool:
        return self.estado in self.FINALES


class MovimientoSolicitud(BaseModel):
    """Un cambio de estado. Append-only: nunca se edita ni se borra."""

    solicitud = models.ForeignKey(
        SolicitudDerechos, related_name="movimientos", on_delete=models.CASCADE
    )
    estado_anterior = models.CharField(
        max_length=15, choices=SolicitudDerechos.Estado.choices, blank=True
    )
    estado_nuevo = models.CharField(max_length=15, choices=SolicitudDerechos.Estado.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    #: Lo que se le dice al titular con este cambio (puede ir vacío al pasar a
    #: EN_PROCESO).
    respuesta = models.TextField(blank=True, default="")

    objects = gestor_de_lo_que_cuelga("solicitud__empresa")

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.solicitud_id}: {self.estado_anterior} -> {self.estado_nuevo}"
