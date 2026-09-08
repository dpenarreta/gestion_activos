"""Parametrización de los criterios de sustitución de activos (RF-06).

Una política puede ser global (`tipo_dispositivo` vacío) o específica de un
tipo de dispositivo. La resolución es "la específica gana sobre la global"
(ver `apps.politicas.services.resolver_politica`), de modo que la empresa
define un piso común una sola vez y lo afina solo donde hace falta.

Cada umbral es opcional por separado: dejar `vida_util_meses` vacío significa
"no evaluar longevidad para este tipo", no "cero meses". Un umbral en blanco
desactiva ese criterio; un umbral en cero lo hace disparar siempre.
"""

from django.db import models

from apps.core.models import BaseModel


class PoliticaObsolescencia(BaseModel):
    """Umbrales que disparan la sugerencia de renovación de RF-07."""

    nombre = models.CharField(max_length=120)
    tipo_dispositivo = models.OneToOneField(
        "activos.TipoDispositivo",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="politica",
        help_text="Vacío = política global, aplicable a los tipos que no tengan una propia.",
    )
    max_mantenimientos = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Intervenciones acumuladas toleradas. Vacío = no evaluar este criterio.",
    )
    max_componentes_criticos = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Piezas críticas sustituidas toleradas. Vacío = no evaluar este criterio.",
    )
    vida_util_meses = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Longevidad máxima en meses. Vacío = no evaluar este criterio.",
    )
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["tipo_dispositivo__nombre", "nombre"]
        verbose_name = "política de obsolescencia"
        verbose_name_plural = "políticas de obsolescencia"
        constraints = [
            # Una sola política global: si hubiera dos, "la global" dejaría de
            # ser una referencia unívoca y la resolución sería arbitraria.
            models.UniqueConstraint(
                fields=["tipo_dispositivo"],
                condition=models.Q(tipo_dispositivo__isnull=True),
                name="unica_politica_global",
            )
        ]

    def __str__(self) -> str:
        alcance = self.tipo_dispositivo.nombre if self.tipo_dispositivo_id else "Global"
        return f"{self.nombre} ({alcance})"

    @property
    def es_global(self) -> bool:
        return self.tipo_dispositivo_id is None
