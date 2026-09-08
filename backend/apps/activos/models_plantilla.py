"""Configuración de las columnas de la plantilla de carga masiva.

Permite que cada empresa decida qué se pide al cargar el inventario: quitar
las columnas que no lleva (costos, ubicación), volver obligatoria una que sí
exige siempre (el custodio), reordenarlas, renombrarlas, y agregar columnas
propias que se guardan como especificaciones del equipo.

Hay un límite que no es configurable: cinco columnas son **estructurales**
—tipo, nombre, número de serie, departamento y fecha de adquisición— porque
sin ellas no se puede crear un activo. El tipo determina el código de barras,
la fecha es la base del cálculo de vida útil y la serie es la clave que evita
duplicados. Permitir desactivarlas no daría flexibilidad: daría un archivo
que siempre falla.
"""

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import BaseModel

# Campos del activo que la plantilla puede pedir. La clave es la del modelo.
CAMPOS_DISPONIBLES = {
    "tipo": "Tipo de dispositivo",
    "nombre": "Nombre del activo",
    "marca": "Marca",
    "modelo": "Modelo",
    "numero_serie": "Número de serie",
    "departamento": "Departamento",
    "fecha_adquisicion": "Fecha de adquisición",
    "custodio": "Código del custodio",
    "ubicacion": "Ubicación",
    "costo_adquisicion": "Costo de compra",
    "proveedor": "Proveedor",
    "fecha_fin_garantia": "Fin de garantía",
    "especificaciones": "Especificaciones",
    "observaciones": "Observaciones",
}

# Sin estas no hay activo posible: no se pueden desactivar ni volver opcionales.
CAMPOS_ESTRUCTURALES = frozenset(
    {"tipo", "nombre", "numero_serie", "departamento", "fecha_adquisicion"}
)

PREFIJO_ESPECIFICACION = "espec:"


class ColumnaPlantillaActivos(BaseModel):
    """Una columna de la plantilla de carga masiva.

    `clave` identifica qué se llena con esa columna: un campo del activo
    (`marca`, `custodio`…) o, con el prefijo `espec:`, una característica de
    hardware que se guarda dentro de `especificaciones`. Lo segundo es lo que
    permite pedir "Procesador" o "Número de factura" como columnas propias sin
    migrar la tabla de activos cada vez.
    """

    clave = models.CharField(
        max_length=80,
        unique=True,
        help_text=(
            "Campo del activo, o 'espec:<Nombre>' para una característica que "
            "se guarda en las especificaciones."
        ),
    )
    etiqueta = models.CharField(max_length=120, help_text="Encabezado que aparece en la plantilla.")
    ayuda = models.CharField(
        max_length=255,
        blank=True,
        help_text="Se muestra como comentario de la celda del encabezado.",
    )
    obligatoria = models.BooleanField(default=False)
    activa = models.BooleanField(
        default=True, help_text="Si se desactiva, la columna no se pide ni se lee."
    )
    orden = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "columna de la plantilla de activos"
        verbose_name_plural = "columnas de la plantilla de activos"

    def __str__(self) -> str:
        return self.etiqueta

    @property
    def es_especificacion(self) -> bool:
        return self.clave.startswith(PREFIJO_ESPECIFICACION)

    @property
    def nombre_especificacion(self) -> str:
        """Nombre de la característica, sin el prefijo."""
        return self.clave[len(PREFIJO_ESPECIFICACION) :] if self.es_especificacion else ""

    @property
    def es_estructural(self) -> bool:
        return self.clave in CAMPOS_ESTRUCTURALES

    @property
    def encabezado(self) -> str:
        """Etiqueta como se imprime en la plantilla, con el asterisco si toca."""
        return f"{self.etiqueta} *" if self.obligatoria else self.etiqueta

    def clean(self):
        if self.es_especificacion:
            if not self.nombre_especificacion.strip():
                raise ValidationError(
                    {"clave": "Indique el nombre de la característica después de 'espec:'."}
                )
        elif self.clave not in CAMPOS_DISPONIBLES:
            raise ValidationError(
                {
                    "clave": (
                        f"{self.clave!r} no es un campo del activo. Use uno de: "
                        f"{', '.join(sorted(CAMPOS_DISPONIBLES))}, o 'espec:<Nombre>'."
                    )
                }
            )

        if self.es_estructural and not self.activa:
            raise ValidationError(
                {
                    "activa": (
                        f"«{self.etiqueta}» no se puede desactivar: sin ese dato no es "
                        "posible crear el activo."
                    )
                }
            )
        if self.es_estructural and not self.obligatoria:
            raise ValidationError(
                {
                    "obligatoria": (
                        f"«{self.etiqueta}» siempre es obligatoria: sin ese dato no es "
                        "posible crear el activo."
                    )
                }
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
