"""Expediente individual de cada activo electrónico (RF-01) y su historial
de movimientos.

Sobre los indicadores desnormalizados de `Activo` (`total_mantenimientos`,
`total_componentes_criticos`, `requiere_renovacion`): son deliberadamente
redundantes respecto de las tablas de mantenimiento. Se mantienen porque el
listado de activos filtra y ordena por ellos, y calcularlos con subconsultas
haría un `COUNT` por fila en cada página. Su fuente de verdad sigue siendo la
bitácora: se recalculan en `apps.mantenimientos.services` tras cada
intervención y, ante cualquier duda, con `manage.py recalcular_indicadores`.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel

# Reexportado para que Django lo descubra: la configuración de la plantilla de
# carga masiva vive en su propio módulo por tamaño, no por ser otra app.
from .models_plantilla import ColumnaPlantillaActivos  # noqa: F401

# Antelación con la que una garantía se considera «por vencer». 30 días es el
# plazo con el que se alcanza a gestionar una renovación o un reclamo con el
# proveedor; con una semana ya no da tiempo a nada.
DIAS_AVISO_GARANTIA = 30


class TipoDispositivo(BaseModel):
    """Clase de equipo (laptop, servidor, impresora...).

    Es la unidad sobre la que se parametrizan las políticas de obsolescencia
    (RF-06): un servidor y una impresora no toleran el mismo número de
    intervenciones ni tienen la misma vida útil.
    """

    nombre = models.CharField(max_length=120, unique=True)
    codigo = models.CharField(
        max_length=10,
        unique=True,
        help_text="Prefijo del código de barras de los activos de este tipo (ej. LAP).",
    )
    descripcion = models.TextField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name = "tipo de dispositivo"
        verbose_name_plural = "tipos de dispositivo"

    def __str__(self) -> str:
        return self.nombre


class Activo(BaseModel):
    """Expediente de un dispositivo electrónico."""

    class Garantia(models.TextChoices):
        SIN_REGISTRAR = "sin_registrar", "Sin garantía registrada"
        VIGENTE = "vigente", "En garantía"
        POR_VENCER = "por_vencer", "Garantía por vencer"
        VENCIDA = "vencida", "Garantía vencida"

    class Estado(models.TextChoices):
        EN_USO = "en_uso", "En uso"
        EN_BODEGA = "en_bodega", "En bodega"
        EN_MANTENIMIENTO = "en_mantenimiento", "En mantenimiento"
        DADO_DE_BAJA = "dado_de_baja", "Dado de baja"

    # --- Identificación (RF-02) ---
    codigo_barras = models.CharField(
        max_length=40,
        unique=True,
        editable=False,
        db_index=True,
        help_text="Generado por el sistema. Es el valor codificado en Code 128.",
    )

    # --- Ficha técnica (RF-01) ---
    tipo = models.ForeignKey(TipoDispositivo, on_delete=models.PROTECT, related_name="activos")
    nombre = models.CharField(max_length=150, help_text="Nombre corto para listados y etiquetas.")
    marca = models.CharField(max_length=80)
    modelo = models.CharField(max_length=120)
    numero_serie = models.CharField(max_length=120, unique=True)
    # Pares clave/valor libres (procesador, RAM, disco...): cada tipo de equipo
    # describe cosas distintas y un esquema fijo obligaría a migrar la tabla
    # cada vez que aparece una característica nueva.
    especificaciones = models.JSONField(default=dict, blank=True)
    observaciones = models.TextField(blank=True)

    # --- Custodia y adscripción (RF-01) ---
    custodio = models.ForeignKey(
        "organizacion.Empleado",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="activos_asignados",
        help_text="Vacío mientras el equipo está en bodega, sin responsable.",
    )
    departamento = models.ForeignKey(
        "organizacion.Departamento",
        on_delete=models.PROTECT,
        related_name="activos",
    )
    ubicacion = models.CharField(max_length=150, blank=True)

    # --- Ciclo de vida (insumo de RF-06 / RF-07) ---
    estado = models.CharField(max_length=20, choices=Estado.choices, default=Estado.EN_BODEGA)
    fecha_adquisicion = models.DateField(
        help_text="Base del cálculo de longevidad de la política de renovación."
    )
    costo_adquisicion = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    proveedor = models.CharField(max_length=150, blank=True)
    fecha_fin_garantia = models.DateField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Fin de la cobertura del proveedor. Vacío = el equipo no tiene garantía registrada.",
    )
    fecha_baja = models.DateField(null=True, blank=True)
    motivo_baja = models.TextField(blank=True)

    # --- Indicadores derivados (ver docstring del módulo) ---
    total_mantenimientos = models.PositiveIntegerField(default=0, editable=False)
    total_componentes_criticos = models.PositiveIntegerField(default=0, editable=False)
    requiere_renovacion = models.BooleanField(default=False, editable=False, db_index=True)
    # Severidad de la sugerencia (§11: "Evaluar reemplazo" / "Reemplazo
    # recomendado"). Se guarda como texto libre en vez de importar las choices
    # de `apps.politicas` para no crear una dependencia circular entre apps:
    # políticas ya importa activos.
    nivel_renovacion = models.CharField(
        max_length=15, default="ninguno", editable=False, db_index=True
    )
    motivos_renovacion = models.JSONField(default=list, blank=True, editable=False)
    renovacion_evaluada_en = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "activo"
        verbose_name_plural = "activos"
        indexes = [
            models.Index(fields=["marca", "modelo"]),
            models.Index(fields=["estado"]),
            models.Index(fields=["requiere_renovacion"]),
        ]

    def __str__(self) -> str:
        return f"{self.codigo_barras} - {self.nombre}"

    @property
    def estado_garantia(self) -> str:
        """Situación de la garantía del equipo.

        Se distingue «sin garantía» de «vencida» a propósito: no es lo mismo un
        equipo cuya cobertura expiró que uno del que nunca se registró la
        fecha. Confundirlos haría que un inventario a medio capturar pareciera
        un parque entero fuera de cobertura.
        """
        if self.fecha_fin_garantia is None:
            return self.Garantia.SIN_REGISTRAR
        dias = self.dias_para_fin_de_garantia
        if dias < 0:
            return self.Garantia.VENCIDA
        if dias <= DIAS_AVISO_GARANTIA:
            return self.Garantia.POR_VENCER
        return self.Garantia.VIGENTE

    @property
    def dias_para_fin_de_garantia(self) -> int | None:
        """Días que faltan (negativo si ya venció). `None` si no hay fecha."""
        if self.fecha_fin_garantia is None:
            return None
        from django.utils import timezone

        return (self.fecha_fin_garantia - timezone.localdate()).days

    @property
    def antiguedad_meses(self) -> int:
        """Meses cumplidos desde la adquisición, en aritmética de calendario
        (no días/30): un equipo comprado el 15 de enero cumple un mes el 15 de
        febrero, tenga febrero 28 o 29 días."""
        from django.utils import timezone

        hoy = timezone.localdate()
        meses = (hoy.year - self.fecha_adquisicion.year) * 12 + (
            hoy.month - self.fecha_adquisicion.month
        )
        if hoy.day < self.fecha_adquisicion.day:
            meses -= 1
        return max(meses, 0)


class MovimientoActivo(BaseModel):
    """Traza de cada cambio de custodio, área o estado de un activo.

    Junto con la bitácora de mantenimientos compone el "historial completo"
    que RF-03 exige mostrar al escanear una etiqueta. Es append-only: no hay
    endpoint que lo edite ni lo borre — un historial de custodia que se puede
    reescribir no sirve para deslindar responsabilidades.
    """

    class Tipo(models.TextChoices):
        ALTA = "alta", "Alta en inventario"
        ASIGNACION = "asignacion", "Asignación de custodio"
        DEVOLUCION = "devolucion", "Devolución a bodega"
        TRASLADO = "traslado", "Traslado de área"
        CAMBIO_ESTADO = "cambio_estado", "Cambio de estado"
        BAJA = "baja", "Baja del inventario"

    activo = models.ForeignKey(Activo, on_delete=models.CASCADE, related_name="movimientos")
    tipo = models.CharField(max_length=20, choices=Tipo.choices)
    custodio_anterior = models.ForeignKey(
        "organizacion.Empleado",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_custodio_anterior",
    )
    custodio_nuevo = models.ForeignKey(
        "organizacion.Empleado",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_custodio_nuevo",
    )
    departamento_anterior = models.ForeignKey(
        "organizacion.Departamento",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_departamento_anterior",
    )
    departamento_nuevo = models.ForeignKey(
        "organizacion.Departamento",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_departamento_nuevo",
    )
    estado_anterior = models.CharField(max_length=20, blank=True)
    estado_nuevo = models.CharField(max_length=20, blank=True)
    motivo = models.TextField(blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_registrados",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "movimiento de activo"
        verbose_name_plural = "movimientos de activos"
        indexes = [models.Index(fields=["activo", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} - {self.activo_id}"
