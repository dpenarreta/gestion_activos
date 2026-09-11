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
from apps.empresas.managers import (
    ConsultaPorEmpresa,
    GestorPorEmpresa,
    gestor_de_lo_que_cuelga,
)
from apps.empresas.models import ModeloDeEmpresa

# Reexportado para que Django lo descubra: la configuración de la plantilla de
# carga masiva vive en su propio módulo por tamaño, no por ser otra app.
from .models_caracteristicas import CaracteristicaTipo  # noqa: F401
from .models_plantilla import ColumnaPlantillaActivos  # noqa: F401

# Antelación con la que una garantía se considera «por vencer». 30 días es el
# plazo con el que se alcanza a gestionar una renovación o un reclamo con el
# proveedor; con una semana ya no da tiempo a nada.
DIAS_AVISO_GARANTIA = 30

#: Estados en los que el equipo ya no forma parte del parque: no se le puede
#: hacer mantenimiento, no se le asigna custodio y no cuenta en los
#: indicadores ni en las alertas. Están juntos en una sola constante porque el
#: criterio se consultaba antes como `exclude(estado=DADO_DE_BAJA)` repetido
#: en nueve archivos, y al aparecer «perdido» y «robado» esa duplicación se
#: convertía en nueve sitios donde olvidar uno de los tres.
ESTADOS_FUERA_DE_INVENTARIO = frozenset({"dado_de_baja", "perdido", "robado"})

#: Estados desde los que una asignación cambia el estado del equipo. Los demás
#: —en reparación, en garantía, en tránsito— describen dónde está, y eso manda
#: sobre quién responde por él: entregarlo no lo saca del taller.
ESTADOS_ASIGNABLES = frozenset({"disponible", "en_uso", "en_bodega"})

#: Equipos almacenados esperando destino. Son dos estados y no uno porque el
#: documento distingue lo que está guardado de lo que ya se puede entregar.
ESTADOS_EN_ALMACEN = frozenset({"disponible", "en_bodega"})


class ActivoQuerySet(ConsultaPorEmpresa):
    """Las consultas propias del inventario, sobre la base que ya filtra.

    Hereda de `ConsultaPorEmpresa` y no de `QuerySet` a propósito: si fuera un
    gestor aparte, `Activo.objects` dejaría de acotar por empresa y el
    inventario entero —la tabla más grande y la que más se consulta— sería el
    único sitio sin aislamiento.
    """

    def operativos(self):
        """Parque vivo: lo que todavía está en la empresa y responde a alguien."""
        return self.exclude(estado__in=ESTADOS_FUERA_DE_INVENTARIO)

    def fuera_de_inventario(self):
        return self.filter(estado__in=ESTADOS_FUERA_DE_INVENTARIO)


class TipoDispositivo(ModeloDeEmpresa):
    """Clase de equipo (laptop, servidor, impresora...).

    Es la unidad sobre la que se parametrizan las políticas de obsolescencia
    (RF-06): un servidor y una impresora no toleran el mismo número de
    intervenciones ni tienen la misma vida útil.
    """

    nombre = models.CharField(max_length=120)
    codigo = models.CharField(
        max_length=10,
        help_text="Prefijo del código de barras de los activos de este tipo (ej. LAP).",
    )
    descripcion = models.TextField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "nombre"], name="tipo_nombre_unico_por_empresa"
            ),
            models.UniqueConstraint(
                fields=["empresa", "codigo"], name="tipo_codigo_unico_por_empresa"
            ),
        ]
        verbose_name = "tipo de dispositivo"
        verbose_name_plural = "tipos de dispositivo"

    def __str__(self) -> str:
        return self.nombre


class Activo(ModeloDeEmpresa):
    """Expediente de un dispositivo electrónico."""

    class Garantia(models.TextChoices):
        SIN_REGISTRAR = "sin_registrar", "Sin garantía registrada"
        VIGENTE = "vigente", "En garantía"
        POR_VENCER = "por_vencer", "Garantía por vencer"
        VENCIDA = "vencida", "Garantía vencida"

    class Estado(models.TextChoices):
        # El documento distingue «disponible» de «en bodega»: los dos están
        # almacenados, pero solo el primero se puede entregar hoy. Un equipo
        # recién devuelto está en bodega y todavía no es entregable —hay que
        # revisarlo y formatearlo—, y contarlo como disponible haría prometer
        # equipos que no lo están.
        DISPONIBLE = "disponible", "Disponible"
        EN_USO = "en_uso", "Asignado"
        EN_BODEGA = "en_bodega", "En bodega"
        EN_MANTENIMIENTO = "en_mantenimiento", "En reparación"
        # «En reclamación de garantía» y no «en garantía» a secas: describe
        # que el equipo está en manos del proveedor por un reclamo, que es un
        # hecho operativo. Que la cobertura esté vigente o no es otra cosa, se
        # deduce de la fecha y se llama `estado_garantia`.
        EN_GARANTIA = "en_garantia", "En reclamación de garantía"
        EN_TRANSITO = "en_transito", "En tránsito"
        DADO_DE_BAJA = "dado_de_baja", "Dado de baja"
        PERDIDO = "perdido", "Perdido"
        ROBADO = "robado", "Robado"

    class Criticidad(models.TextChoices):
        BAJA = "baja", "Baja"
        MEDIA = "media", "Media"
        ALTA = "alta", "Alta"
        CRITICA = "critica", "Crítica"

    class Propiedad(models.TextChoices):
        """De quién es el equipo, que no es lo mismo que a quién se le compró.

        `proveedor` responde «a quién le compramos esto»; esto responde «de
        quién es». Un equipo en concesión lo pone un partner para operar con
        nosotros: la compra corre por su cuenta y el mantenimiento por la
        nuestra, así que sus reparaciones sí son gasto propio y su valor en
        libros no es de la empresa.

        Por defecto, propio: es lo que ocurre con casi todo el parque, y la
        concesión es la excepción que alguien conoce y declara.
        """

        PROPIA = "propia", "De la empresa"
        CONCESION = "concesion", "En concesión"

    class Condicion(models.TextChoices):
        """Cómo llegó el equipo a la empresa: comprado nuevo o de segunda mano.

        Es una propiedad de la **compra**, no del estado de hoy: un equipo
        adquirido usado lo sigue habiendo sido tres años después, y por eso no
        se mezcla con `estado`, que cambia cada vez que el equipo se mueve.

        Importa al decidir: un equipo usado llega con parte de su vida ya
        gastada, así que sus mismos cuarenta y ocho meses de antigüedad no
        significan lo mismo que los de uno comprado nuevo. Aquí solo se
        registra —no entra en ninguna regla automática— porque quien decide un
        reemplazo necesita el dato, no que el sistema lo interprete por él.
        """

        NUEVO = "nuevo", "Nuevo"
        USADO = "usado", "Usado"

    class Uso(models.TextChoices):
        """Función que cumple el equipo, no cuánto se usa.

        Dos laptops idénticas pueden ser una de gerencia y otra de bodega, y
        eso cambia con qué urgencia se repone cada una.
        """

        ADMINISTRATIVO = "administrativo", "Administrativo"
        OPERATIVO = "operativo", "Operativo"
        DESARROLLO = "desarrollo", "Desarrollo"
        DISENO = "diseno", "Diseño"
        GERENCIAL = "gerencial", "Gerencial"
        ATENCION_CLIENTE = "atencion_cliente", "Atención al cliente"
        BODEGA = "bodega", "Bodega"
        INFRAESTRUCTURA = "infraestructura", "Infraestructura"

    # --- Identificación (RF-02) ---
    codigo_barras = models.CharField(
        max_length=40,
        editable=False,
        db_index=True,
        help_text="Generado por el sistema. Es el valor codificado en Code 128.",
    )

    # --- Ficha técnica (RF-01) ---
    tipo = models.ForeignKey(TipoDispositivo, on_delete=models.PROTECT, related_name="activos")
    nombre = models.CharField(max_length=150, help_text="Nombre corto para listados y etiquetas.")
    marca = models.CharField(max_length=80)
    modelo = models.CharField(max_length=120)
    numero_serie = models.CharField(max_length=120)
    # Pares clave/valor libres (procesador, RAM, disco...): cada tipo de equipo
    # describe cosas distintas y un esquema fijo obligaría a migrar la tabla
    # cada vez que aparece una característica nueva.
    especificaciones = models.JSONField(default=dict, blank=True)
    observaciones = models.TextField(blank=True)

    # --- Custodia y adscripción (RF-01) ---
    #: Marca el equipo que varias personas usan y del que varias responden: un
    #: escáner de andén, una impresora de mostrador, una laptop de turno. Es una
    #: decisión explícita y no una consecuencia de sumar gente, porque repartir
    #: la responsabilidad de una laptop personal entre tres nombres es
    #: exactamente lo que hace que después nadie responda por ella.
    compartido = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Varias personas responden por él, en igualdad. Ej.: un escáner de andén.",
    )
    #: Quiénes responden por el equipo. Son varios solo si está marcado como
    #: compartido, y entonces **ninguno manda sobre otro**: no hay un titular
    #: con acompañantes, hay tres personas que responden igual y cada una firma
    #: su propia acta. Un equipo sin nadie está en bodega.
    responsables = models.ManyToManyField(
        "organizacion.Empleado",
        related_name="activos_asignados",
        blank=True,
        help_text="Vacío mientras el equipo está en bodega, sin responsable.",
    )
    departamento = models.ForeignKey(
        "organizacion.Departamento",
        on_delete=models.PROTECT,
        related_name="activos",
    )
    sede = models.ForeignKey(
        "organizacion.Sede",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="activos",
        help_text="Dónde está el equipo. Vacío mientras no se ha inventariado.",
    )

    # --- Clasificación (§12) ---
    # Criticidad y nivel de uso no se derivan del tipo de equipo: dos laptops
    # idénticas pueden ser una la del servidor de facturación y otra la de un
    # puesto de rotación, y esa diferencia es justamente la que decide a cuál
    # se atiende primero cuando ambas fallan el mismo día.
    criticidad = models.CharField(
        max_length=10, choices=Criticidad.choices, default=Criticidad.MEDIA, db_index=True
    )
    uso = models.CharField(
        max_length=20, choices=Uso.choices, default=Uso.ADMINISTRATIVO, db_index=True
    )

    # --- Ciclo de vida (insumo de RF-06 / RF-07) ---
    estado = models.CharField(max_length=20, choices=Estado.choices, default=Estado.EN_BODEGA)
    fecha_adquisicion = models.DateField(
        help_text="Base del cálculo de longevidad de la política de renovación."
    )
    fecha_ingreso = models.DateField(
        null=True,
        blank=True,
        help_text=(
            "Fecha en que el equipo entró al inventario. Se separa de la de "
            "adquisición porque un equipo comprado en diciembre puede entrar en "
            "marzo, y la garantía corre desde una y la custodia desde la otra."
        ),
    )
    costo_adquisicion = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    condicion = models.CharField(
        max_length=10,
        choices=Condicion.choices,
        blank=True,
        db_index=True,
        verbose_name="condición al adquirirlo",
        help_text=(
            "Si el equipo se compró nuevo o se adquirió de segunda mano. Vacío = no "
            "consta: el inventario inicial se levanta con equipos cuya procedencia "
            "ya nadie recuerda, y dar «nuevo» por supuesto sería inventarla."
        ),
    )
    propiedad = models.CharField(
        max_length=10,
        choices=Propiedad.choices,
        default=Propiedad.PROPIA,
        db_index=True,
        help_text="Si el equipo es de la empresa o lo pone un partner en concesión.",
    )
    concesionario = models.ForeignKey(
        "organizacion.Concesionario",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="activos",
        help_text=(
            "De quién es el equipo cuando está en concesión. Distinto del proveedor: "
            "ese dice a quién se le compró."
        ),
    )
    proveedor = models.ForeignKey(
        "organizacion.Proveedor",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="activos",
        help_text="A quién se le compró. Se elige del catálogo de proveedores.",
    )
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

    objects = GestorPorEmpresa.from_queryset(ActivoQuerySet)()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "activo"
        verbose_name_plural = "activos"
        constraints = [
            # Por empresa y no globales: dos empresas del grupo numeran sus
            # equipos por su cuenta, y la serie de fábrica de una laptop puede
            # repetirse entre inventarios que nunca se cruzan.
            models.UniqueConstraint(
                fields=["empresa", "codigo_barras"], name="activo_codigo_unico_por_empresa"
            ),
            models.UniqueConstraint(
                fields=["empresa", "numero_serie"], name="activo_serie_unica_por_empresa"
            ),
        ]
        indexes = [
            models.Index(fields=["marca", "modelo"]),
            models.Index(fields=["estado"]),
            models.Index(fields=["requiere_renovacion"]),
            models.Index(fields=["sede"]),
            models.Index(fields=["fecha_adquisicion"]),
        ]

    def __str__(self) -> str:
        return f"{self.codigo_barras} - {self.nombre}"

    @property
    def es_de_la_empresa(self) -> bool:
        """Si el equipo pertenece a la empresa.

        Lo consultan la depreciación y el valor del parque: un equipo en
        concesión se mantiene con dinero propio pero no se compró con él, así
        que contarlo como patrimonio abultaría el balance con algo que es de
        otro.
        """
        return self.propiedad == self.Propiedad.PROPIA

    @property
    def responsables_ordenados(self) -> list:
        """Quiénes responden, en el orden en que se leen: por apellido.

        Ordenarlos por cuándo se sumaron sugeriría una antigüedad que aquí no
        significa nada —ninguno manda sobre otro—, y dejarlos en el orden que
        devuelva la base haría que la misma ficha se leyera distinta en dos
        pantallazos.
        """
        return sorted(self.responsables.all(), key=lambda e: (e.apellidos, e.nombres))

    @property
    def responsable_unico(self):
        """El único responsable, o `None` si no hay ninguno o hay varios.

        Existe para lo que **solo tiene sentido con uno**: el acta de un equipo
        personal, la columna de una hoja de cálculo. Devuelve `None` con tres
        responsables a propósito, en vez de elegir uno: elegir sería inventar
        un titular donde se decidió que no lo hubiera.
        """
        responsables = self.responsables_ordenados
        return responsables[0] if len(responsables) == 1 else None

    @property
    def resumen_de_responsables(self) -> str:
        """Quién responde, para leerlo de un vistazo en una lista o una celda.

        Con uno, su nombre. Con varios, todos separados por coma: un «3
        responsables» obligaría a abrir la ficha para saber a quién llamar, que
        es justo lo que se está preguntando al mirar la columna.
        """
        return ", ".join(e.nombre_completo for e in self.responsables_ordenados)

    @property
    def esta_asignado(self) -> bool:
        """Si alguien responde hoy por el equipo."""
        return bool(self.responsables_ordenados)

    @property
    def esta_operativo(self) -> bool:
        """Si el equipo sigue formando parte del parque."""
        return self.estado not in ESTADOS_FUERA_DE_INVENTARIO

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
    # El sitio también se mueve, y hasta hace poco no quedaba en el historial:
    # un equipo cambiaba de sede y la ficha lo reflejaba, pero nadie podía
    # reconstruir cuándo ni por qué. Para un inventario repartido en varias
    # ciudades, eso es justo lo que hay que poder auditar.
    sede_anterior = models.ForeignKey(
        "organizacion.Sede",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_origen",
    )
    sede_nueva = models.ForeignKey(
        "organizacion.Sede",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_destino",
    )
    # Los dos campos de abajo son historia congelada: los traslados anteriores
    # al cambio se registraron entre bodegas, no entre sedes. Ya nadie los
    # escribe, pero borrarlos reescribiría movimientos que alguien firmó.
    ubicacion_anterior = models.ForeignKey(
        "organizacion.Ubicacion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_origen",
    )
    ubicacion_nueva = models.ForeignKey(
        "organizacion.Ubicacion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_como_destino",
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

    #: La empresa la pone el activo movido: el historial de una no se lee
    #: desde la otra.
    objects = gestor_de_lo_que_cuelga("activo__empresa")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "movimiento de activo"
        verbose_name_plural = "movimientos de activos"
        indexes = [models.Index(fields=["activo", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} - {self.activo_id}"
