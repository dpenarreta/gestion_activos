"""Configuración del centro de alertas (§19 del documento funcional).

El documento enumera siete situaciones que el sistema debe advertir. Todas se
calculan al vuelo sobre el inventario: no hay una tabla de «alertas
generadas». Guardarlas obligaría a un proceso que las creara y —lo difícil—
las borrara cuando la situación se resuelve; una alerta persistida que nadie
retira envejece hasta que el usuario deja de mirarlas.

Lo que sí se guarda son los umbrales, porque «demasiado tiempo» significa
cosas distintas en cada empresa, y cuáles de las siete están encendidas: una
alerta que no se puede apagar acaba siendo ruido que se ignora en bloque.

También se guarda a quién avisar por correo y cuándo, más la bitácora de lo
que ya se envió: sin ella, «¿llegó el aviso del lunes?» no tiene respuesta
dentro del sistema, y un envío que falla en silencio es peor que no tener
envío, porque genera confianza en que alguien fue advertido.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel
from apps.empresas.models import ModeloDeEmpresa


class Frecuencia(models.TextChoices):
    DIARIA = "diaria", "Diaria"
    SEMANAL = "semanal", "Semanal"


#: `weekday()` de Python: lunes es 0. Se guarda el número y no el nombre para
#: no depender del idioma con el que se configuró el sistema.
DIAS_SEMANA = [
    (0, "Lunes"),
    (1, "Martes"),
    (2, "Miércoles"),
    (3, "Jueves"),
    (4, "Viernes"),
    (5, "Sábado"),
    (6, "Domingo"),
]


class ConfiguracionAlertas(ModeloDeEmpresa):
    """Parámetros del centro de alertas. Fila única.

    Es un singleton porque los umbrales son una decisión de la empresa, no de
    cada usuario: si cada uno tuviera los suyos, dos personas mirando el mismo
    parque verían dos realidades distintas y no podrían acordar qué atender.
    """

    dias_sin_asignar = models.PositiveIntegerField(
        default=90,
        help_text="Días en bodega sin asignarse a partir de los cuales se avisa.",
    )
    dias_reparacion_pendiente = models.PositiveIntegerField(
        default=15,
        help_text="Días en reparación sin fecha de salida a partir de los cuales se avisa.",
    )
    dias_sin_actualizacion = models.PositiveIntegerField(
        default=365,
        help_text="Días sin ningún cambio en la ficha a partir de los cuales se avisa.",
    )

    avisar_proximos_a_reemplazo = models.BooleanField(default=True)
    avisar_garantias_por_vencer = models.BooleanField(default=True)
    avisar_demasiadas_reparaciones = models.BooleanField(default=True)
    avisar_sin_asignar = models.BooleanField(default=True)
    avisar_reparaciones_pendientes = models.BooleanField(default=True)
    avisar_custodios_inactivos = models.BooleanField(default=True)
    avisar_sin_actualizacion = models.BooleanField(default=True)

    # --- Envío por correo (§19) ---
    # Apagado de fábrica: un sistema recién instalado no tiene todavía un
    # servidor SMTP configurado ni destinatarios elegidos, y un intento de
    # envío en esas condiciones solo produce errores en el log.
    notificaciones_activas = models.BooleanField(
        default=False,
        help_text="Enviar el resumen de alertas por correo a los destinatarios elegidos.",
    )
    frecuencia = models.CharField(
        max_length=10,
        choices=Frecuencia.choices,
        default=Frecuencia.DIARIA,
        help_text="Cada cuánto se envía el resumen.",
    )
    dia_envio_semanal = models.PositiveSmallIntegerField(
        choices=DIAS_SEMANA,
        default=0,
        help_text="Día de la semana del envío, cuando la frecuencia es semanal.",
    )
    omitir_si_no_hay_pendientes = models.BooleanField(
        default=True,
        help_text=("No enviar el correo los días en que ninguna alerta tiene equipos pendientes."),
    )
    destinatarios = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="alertas_suscritas",
        help_text="Usuarios que reciben el resumen. Solo los que pueden ver las alertas.",
    )
    ultimo_envio = models.DateField(
        null=True,
        blank=True,
        help_text="Fecha del último resumen enviado. Evita que dos pasadas del cron dupliquen.",
    )

    class Meta:
        verbose_name = "configuración de alertas"
        verbose_name_plural = "configuración de alertas"

    def __str__(self) -> str:
        return "Configuración de alertas"

    def save(self, *args, **kwargs):
        # El id fijo es lo que hace imposible una segunda fila: sin él, dos
        # peticiones concurrentes de «guardar» crearían dos configuraciones y
        # `cargar()` devolvería la que llegara primero, sin forma de saber
        # cuál rige.
        self.pk = 1
        if self.created_at is None:
            # Fijar el id convierte el alta de una instancia nueva en un UPDATE
            # de la fila existente, y en un UPDATE Django no rellena los campos
            # `auto_now_add`: hay que conservar el valor que ya está guardado
            # (o inventarlo si esta es la primera vez).
            self.created_at = (
                type(self).objects.filter(pk=1).values_list("created_at", flat=True).first()
                or timezone.now()
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError(
            "La configuración de alertas no se elimina; desactive las alertas que no quiera."
        )

    @classmethod
    def cargar(cls) -> "ConfiguracionAlertas":
        """Configuración vigente, creándola con los valores por defecto la
        primera vez. Nunca devuelve `None`: el centro de alertas debe poder
        responder aunque nadie haya entrado todavía a configurarlo."""
        configuracion, _ = cls.objects.get_or_create(pk=1)
        return configuracion

    def toca_enviar_hoy(self, hoy) -> bool:
        """Si corresponde enviar el resumen en la fecha dada.

        La frecuencia vive aquí y no en el cron porque el cron es
        infraestructura: quien configura las alertas no tiene acceso a él, y
        cambiar «semanal» por «diaria» no debería requerir un administrador de
        servidores. El cron corre todos los días y esta función decide.
        """
        if self.ultimo_envio == hoy:
            # Dos pasadas el mismo día (un reintento, un cron duplicado) no
            # producen dos correos: el segundo sería idéntico al primero y
            # restaría credibilidad a los dos.
            return False
        if self.frecuencia == Frecuencia.SEMANAL:
            return hoy.weekday() == self.dia_envio_semanal
        return True


class EnvioAlertas(BaseModel):
    """Bitácora de los resúmenes enviados. Append-only, como la auditoría.

    Registra también lo que *no* se envió y por qué. Un envío omitido y un
    envío fallido se parecen desde fuera —nadie recibió nada— pero el primero
    es el sistema funcionando y el segundo es un problema que hay que
    atender; sin este registro, ambos son igual de invisibles.

    Los destinatarios se guardan como identificadores de usuario y no como
    direcciones: la dirección es un dato de contacto y esta tabla no se purga
    (ver `docs/data-protection-review.md`).
    """

    class Resultado(models.TextChoices):
        ENVIADO = "enviado", "Enviado"
        OMITIDO = "omitido", "Omitido"
        FALLIDO = "fallido", "Fallido"

    class Origen(models.TextChoices):
        PROGRAMADO = "programado", "Programado"
        PRUEBA = "prueba", "Prueba manual"

    resultado = models.CharField(max_length=10, choices=Resultado.choices, db_index=True)
    origen = models.CharField(
        max_length=12, choices=Origen.choices, default=Origen.PROGRAMADO, db_index=True
    )
    motivo = models.CharField(
        max_length=200,
        blank=True,
        help_text="Por qué se omitió o falló. Vacío cuando el envío fue correcto.",
    )
    destinatarios = models.JSONField(
        default=list, blank=True, help_text="Identificadores de los usuarios que lo recibieron."
    )
    total_alertas = models.PositiveIntegerField(default=0)
    total_elementos = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "envío de alertas"
        verbose_name_plural = "envíos de alertas"
        indexes = [models.Index(fields=["created_at"])]

    def __str__(self) -> str:
        return f"{self.get_resultado_display()} el {self.created_at:%Y-%m-%d %H:%M}"
