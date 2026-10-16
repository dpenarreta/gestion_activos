"""Mantenimiento de sedes: las órdenes de trabajo sobre edificios y agencias.

No es el módulo de Mantenimientos del inventario, que registra intervenciones
sobre un equipo concreto. Una orden de trabajo es sobre un **lugar**: la luz
de la agencia de Ambato, el aire acondicionado de la bodega de Manta. Nace como
una petición de quien está en la sede, la asigna quien coordina, la ejecuta un
técnico —interno o de un proveedor— y la acepta quien responde por la sede.

Cada paso queda en `MovimientoOrden` (lo que se ve en la ficha y en «Actividad
reciente») y en la bitácora del sistema (`AuditLog`).
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa

CERO = Decimal("0")


class OrdenTrabajo(ModeloDeEmpresa):
    class Estado(models.TextChoices):
        SOLICITADA = "solicitada", "Solicitada"
        ASIGNADA = "asignada", "Asignada"
        PROGRAMADA = "programada", "Programada"
        EN_EJECUCION = "en_ejecucion", "En ejecución"
        PAUSADA = "pausada", "Pausada"
        PENDIENTE_APROBACION = "pendiente_aprobacion", "Pendiente de aprobación"
        CERRADA = "cerrada", "Cerrada"

    class Prioridad(models.TextChoices):
        CRITICA = "critica", "Crítica"
        ALTA = "alta", "Alta"
        MEDIA = "media", "Media"
        BAJA = "baja", "Baja"

    class Categoria(models.TextChoices):
        ELECTRICO = "electrico", "Eléctrico"
        CLIMATIZACION = "climatizacion", "Climatización"
        PLOMERIA = "plomeria", "Plomería"
        ESTRUCTURAL = "estructural", "Estructural"
        CERRAJERIA = "cerrajeria", "Cerrajería"
        REDES = "redes", "Redes y datos"
        PINTURA = "pintura", "Pintura"
        GENERADOR = "generador", "Generador"
        OTRO = "otro", "Otro"

    #: A dónde puede ir cada estado. Lo que no está aquí no pasa: una orden
    #: cerrada no vuelve a abrirse —si el problema reaparece es otra orden—, y
    #: una pendiente de aprobación solo se cierra o se devuelve a ejecución.
    TRANSICIONES = {
        Estado.SOLICITADA: {Estado.ASIGNADA},
        Estado.ASIGNADA: {Estado.PROGRAMADA, Estado.EN_EJECUCION},
        Estado.PROGRAMADA: {Estado.EN_EJECUCION},
        Estado.EN_EJECUCION: {Estado.PAUSADA, Estado.PENDIENTE_APROBACION},
        Estado.PAUSADA: {Estado.EN_EJECUCION},
        Estado.PENDIENTE_APROBACION: {Estado.CERRADA, Estado.EN_EJECUCION},
        Estado.CERRADA: set(),
    }

    anio = models.PositiveSmallIntegerField(editable=False)
    secuencia = models.PositiveIntegerField(editable=False)

    sede = models.ForeignKey(
        "organizacion.Sede", on_delete=models.PROTECT, related_name="ordenes_de_trabajo"
    )
    categoria = models.CharField(max_length=15, choices=Categoria.choices)
    prioridad = models.CharField(max_length=10, choices=Prioridad.choices, default=Prioridad.MEDIA)
    estado = models.CharField(max_length=25, choices=Estado.choices, default=Estado.SOLICITADA)
    titulo = models.CharField(max_length=150, help_text="Qué hay que hacer, en una línea.")
    descripcion = models.TextField(
        blank=True, help_text="El problema, como lo ve quien lo reporta."
    )

    solicitante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="ordenes_solicitadas"
    )
    #: Dato personal: se muestra enmascarado a quien no tiene
    #: `ordenes.ver_contacto` (ver `serializers.enmascarar_telefono`).
    telefono_contacto = models.CharField(max_length=20, blank=True)

    #: Quien ejecuta: un técnico interno o la persona del proveedor, siempre
    #: con cuenta en el sistema (registra materiales y horas). Si es externo,
    #: `proveedor` dice de qué empresa.
    tecnico = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ordenes_asignadas",
    )
    proveedor = models.ForeignKey(
        "organizacion.Proveedor",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ordenes_de_trabajo",
    )
    fecha_programada = models.DateField(null=True, blank=True)
    fecha_cierre = models.DateTimeField(null=True, blank=True)
    #: Al aceptar el trabajo, quien responde por la sede puede dejar reparos
    #: («quedó una mancha en el techo»): la orden se cierra igual, y cuenta en
    #: el indicador «Con observaciones».
    con_observaciones = models.BooleanField(default=False)
    observaciones_cierre = models.TextField(blank=True)

    class Meta:
        ordering = ["-anio", "-secuencia"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "anio", "secuencia"], name="orden_trabajo_numero_unico"
            )
        ]
        verbose_name = "orden de trabajo"
        verbose_name_plural = "órdenes de trabajo"

    def __str__(self) -> str:
        return self.numero

    @property
    def numero(self) -> str:
        return f"OT-{self.anio}-{self.secuencia:06d}"

    @property
    def esta_cerrada(self) -> bool:
        return self.estado == self.Estado.CERRADA

    def puede_pasar_a(self, estado: str) -> bool:
        return estado in self.TRANSICIONES.get(self.estado, set())

    def cumplimiento(self, hoy=None) -> str:
        """Cerrada, vencida, en plazo o sin fecha.

        Vencida es abierta con la fecha programada ya pasada: es lo que pinta de
        rojo el panel. Sin fecha programada no se puede decir que esté atrasada.
        """
        if self.esta_cerrada:
            return "cerrada"
        if not self.fecha_programada:
            return "sin_fecha"
        hoy = hoy or timezone.localdate()
        return "vencida" if self.fecha_programada < hoy else "en_plazo"

    def costos(self) -> dict:
        """Subtotal de materiales y mano de obra, IVA y total.

        Se calcula al leer en vez de guardarse: un total almacenado se queda
        viejo en cuanto alguien corrige una cantidad. Usa las filas ya
        cargadas (`prefetch_related`) si las hay.
        """
        materiales = sum((m.subtotal for m in self.materiales.all()), CERO)
        mano_de_obra = sum((h.subtotal for h in self.mano_de_obra.all()), CERO)
        subtotal = materiales + mano_de_obra
        iva = (subtotal * Decimal(settings.ORDENES_IVA_PORCENTAJE) / 100).quantize(Decimal("0.01"))
        return {
            "materiales": materiales,
            "mano_de_obra": mano_de_obra,
            "subtotal": subtotal,
            "iva_porcentaje": settings.ORDENES_IVA_PORCENTAJE,
            "iva": iva,
            "total": subtotal + iva,
        }


class MaterialOrden(BaseModel):
    orden = models.ForeignKey(OrdenTrabajo, on_delete=models.CASCADE, related_name="materiales")
    descripcion = models.CharField(max_length=150)
    cantidad = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))]
    )
    costo_unitario = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[MinValueValidator(CERO)]
    )
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )

    objects = gestor_de_lo_que_cuelga("orden__empresa")

    class Meta:
        ordering = ["created_at"]

    @property
    def subtotal(self) -> Decimal:
        return (self.cantidad * self.costo_unitario).quantize(Decimal("0.01"))


class ManoDeObraOrden(BaseModel):
    orden = models.ForeignKey(OrdenTrabajo, on_delete=models.CASCADE, related_name="mano_de_obra")
    descripcion = models.CharField(max_length=150)
    horas = models.DecimalField(
        max_digits=6, decimal_places=2, validators=[MinValueValidator(Decimal("0.25"))]
    )
    costo_hora = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(CERO)]
    )
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )

    objects = gestor_de_lo_que_cuelga("orden__empresa")

    class Meta:
        ordering = ["created_at"]

    @property
    def subtotal(self) -> Decimal:
        return (self.horas * self.costo_hora).quantize(Decimal("0.01"))


class MovimientoOrden(BaseModel):
    """Cada paso de una orden, con quién lo dio. Solo se agregan filas."""

    orden = models.ForeignKey(OrdenTrabajo, on_delete=models.CASCADE, related_name="movimientos")
    estado_anterior = models.CharField(
        max_length=25, choices=OrdenTrabajo.Estado.choices, blank=True
    )
    estado_nuevo = models.CharField(max_length=25, choices=OrdenTrabajo.Estado.choices, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    #: Lo que pasó, en una frase («Asignó la orden a Jorge Andrade»).
    descripcion = models.CharField(max_length=255)
    nota = models.TextField(blank=True)

    objects = gestor_de_lo_que_cuelga("orden__empresa")

    class Meta:
        ordering = ["created_at"]
