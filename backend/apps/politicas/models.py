"""Parametrización de los criterios de sustitución de activos (RF-06).

Una política puede ser global (`tipo_dispositivo` vacío) o específica de un
tipo de dispositivo. La resolución es "la específica gana sobre la global"
(ver `apps.politicas.services.resolver_politica`), de modo que la empresa
define un piso común una sola vez y lo afina solo donde hace falta.

Cada umbral es opcional por separado: dejar `vida_util_meses` vacío significa
"no evaluar longevidad para este tipo", no "cero meses". Un umbral en blanco
desactiva ese criterio; un umbral en cero lo hace disparar siempre.

Los umbrales están escalonados en dos niveles (§11 del documento funcional):
`vida_util_meses` sugiere *evaluar* el reemplazo y `vida_util_critica_meses`
lo *recomienda*. Un solo nivel obligaba a elegir entre avisar tarde o llenar
la pantalla de alertas que nadie puede atender todas a la vez.
"""

from django.db import models

from apps.empresas.models import ModeloDeEmpresa

#: Ventana móvil por defecto para contar reparaciones (§11: "más de 3
#: reparaciones en 12 meses").
VENTANA_MANTENIMIENTOS_MESES = 12


class NivelRenovacion(models.TextChoices):
    """Severidad de la sugerencia. El orden importa: ver `mas_severo`."""

    NINGUNO = "ninguno", "Sin sugerencia"
    EVALUAR = "evaluar", "Evaluar reemplazo"
    RECOMENDADO = "recomendado", "Reemplazo recomendado"


#: De menor a mayor severidad. Un activo que dispara varios criterios se
#: reporta con el más alto: rebajarlo al primero que se evaluó dependería del
#: orden del código, no de la gravedad.
ORDEN_NIVELES = [
    NivelRenovacion.NINGUNO,
    NivelRenovacion.EVALUAR,
    NivelRenovacion.RECOMENDADO,
]


def mas_severo(*niveles: str) -> str:
    """Devuelve el nivel más alto de los recibidos."""
    return max(
        (n for n in niveles if n),
        key=lambda nivel: ORDEN_NIVELES.index(nivel),
        default=NivelRenovacion.NINGUNO,
    )


class PoliticaObsolescencia(ModeloDeEmpresa):
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
        help_text="Intervenciones toleradas. Vacío = no evaluar este criterio.",
    )
    ventana_mantenimientos_meses = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text=(
            "Meses hacia atrás en los que se cuentan las intervenciones. "
            "Vacío = se cuenta todo el historial del equipo."
        ),
    )
    max_componentes_criticos = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Piezas críticas sustituidas toleradas. Vacío = no evaluar este criterio.",
    )
    vida_util_meses = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Meses a partir de los cuales conviene evaluar el reemplazo. Vacío = no evaluar.",
    )
    vida_util_critica_meses = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text=(
            "Meses a partir de los cuales el reemplazo se recomienda. "
            "Debe ser mayor que la vida útil. Vacío = no hay segundo nivel."
        ),
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
                fields=["empresa", "tipo_dispositivo"],
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

    @property
    def cuenta_historial_completo(self) -> bool:
        """Si el conteo de intervenciones ignora la ventana móvil.

        Sin ventana el contador solo sube: un equipo que falló mucho hace seis
        años sigue marcado aunque lleve años sin una sola intervención.
        """
        return self.ventana_mantenimientos_meses is None
