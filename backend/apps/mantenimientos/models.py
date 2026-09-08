"""Bitácora de intervenciones sobre los activos (RF-04) y el catálogo de
componentes que las alimenta.

`ComponenteUtilizado.era_critico` copia el valor de `CatalogoComponente.es_critico`
al momento de registrar el consumo, en vez de leerlo por la relación. Es
intencional: si mañana la empresa deja de considerar crítico un disco duro,
las intervenciones ya registradas —y los conteos de RF-06 que se calcularon a
partir de ellas— deben seguir reflejando la regla vigente cuando ocurrieron.
Sin ese snapshot, un cambio de catálogo reescribiría el historial hacia atrás.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class CatalogoComponente(BaseModel):
    """Pieza o repuesto que puede consumirse en un mantenimiento.

    `es_critico` es lo que hace que un reemplazo cuente contra el umbral de
    "piezas críticas sustituidas" de la política de renovación (RF-06).
    """

    nombre = models.CharField(max_length=150, unique=True)
    codigo = models.CharField(max_length=30, unique=True)
    descripcion = models.TextField(blank=True)
    es_critico = models.BooleanField(
        default=False,
        help_text=(
            "Marca las piezas cuyo reemplazo cuenta contra el umbral de la "
            "política de renovación (tarjeta madre, disco duro, fuente de poder...)."
        ),
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name = "componente del catálogo"
        verbose_name_plural = "catálogo de componentes"

    def __str__(self) -> str:
        return self.nombre


class Mantenimiento(BaseModel):
    """Un evento de mantenimiento sobre un activo (RF-04)."""

    class Tipo(models.TextChoices):
        PREVENTIVO = "preventivo", "Preventivo"
        CORRECTIVO = "correctivo", "Correctivo"

    class TipoResponsable(models.TextChoices):
        TECNICO_INTERNO = "tecnico_interno", "Técnico interno"
        PROVEEDOR_EXTERNO = "proveedor_externo", "Proveedor externo"

    activo = models.ForeignKey(
        "activos.Activo", on_delete=models.PROTECT, related_name="mantenimientos"
    )
    tipo = models.CharField(max_length=15, choices=Tipo.choices)
    fecha_intervencion = models.DateField()
    tipo_responsable = models.CharField(max_length=20, choices=TipoResponsable.choices)
    responsable = models.CharField(
        max_length=150, help_text="Nombre del técnico interno o del proveedor externo."
    )
    descripcion = models.TextField(help_text="Trabajo realizado, en detalle.")
    diagnostico = models.TextField(blank=True)
    costo_mano_obra = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mantenimientos_registrados",
    )

    class Meta:
        ordering = ["-fecha_intervencion", "-created_at"]
        verbose_name = "mantenimiento"
        verbose_name_plural = "mantenimientos"
        indexes = [
            models.Index(fields=["activo", "-fecha_intervencion"]),
            models.Index(fields=["tipo"]),
        ]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} {self.fecha_intervencion} - activo {self.activo_id}"

    @property
    def costo_total(self):
        """Mano de obra más repuestos. Devuelve Decimal; nunca None, para que
        el llamador pueda sumar sin comprobar."""
        from decimal import Decimal

        total = self.costo_mano_obra or Decimal("0")
        for componente in self.componentes.all():
            total += componente.costo_total
        return total


class ComponenteUtilizado(BaseModel):
    """Repuesto consumido en un mantenimiento (el desglose que pide RF-04)."""

    mantenimiento = models.ForeignKey(
        Mantenimiento, on_delete=models.CASCADE, related_name="componentes"
    )
    componente = models.ForeignKey(
        CatalogoComponente, on_delete=models.PROTECT, related_name="usos"
    )
    cantidad = models.PositiveIntegerField(default=1)
    costo_unitario = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    numero_serie_nuevo = models.CharField(
        max_length=120, blank=True, help_text="Serie de la pieza instalada, si aplica."
    )
    # Snapshot deliberado: ver el docstring del módulo.
    era_critico = models.BooleanField(default=False, editable=False)
    observaciones = models.TextField(blank=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "componente utilizado"
        verbose_name_plural = "componentes utilizados"

    def __str__(self) -> str:
        return f"{self.componente_id} x{self.cantidad}"

    @property
    def costo_total(self):
        from decimal import Decimal

        return (self.costo_unitario or Decimal("0")) * self.cantidad
