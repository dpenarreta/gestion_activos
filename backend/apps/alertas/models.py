"""Configuración del centro de alertas (§19 del documento funcional).

El documento enumera siete situaciones que el sistema debe advertir. Todas se
calculan al vuelo sobre el inventario: no hay una tabla de «alertas
generadas». Guardarlas obligaría a un proceso que las creara y —lo difícil—
las borrara cuando la situación se resuelve; una alerta persistida que nadie
retira envejece hasta que el usuario deja de mirarlas.

Lo que sí se guarda son los umbrales, porque «demasiado tiempo» significa
cosas distintas en cada empresa, y cuáles de las siete están encendidas: una
alerta que no se puede apagar acaba siendo ruido que se ignora en bloque.
"""

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class ConfiguracionAlertas(BaseModel):
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
