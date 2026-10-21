"""Catálogos organizacionales: a qué área pertenece un activo y quién lo
custodia (RF-01).

`Empleado` es un catálogo propio y no `settings.AUTH_USER_MODEL`. Hasta el
21/10/2026 el vínculo con la cuenta era opcional; desde entonces todo
empleado tiene usuario (pedir permisos, rol de pagos, onboarding: sin cuenta
no sirve). El alta del empleado crea o ata la cuenta —ver `cuentas.py`—. La
columna sigue admitiendo nulos solo por los empleados anteriores que quedan
«Sin usuario»: no se pueden editar hasta completarlos.
"""

import re
import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa

#: Prefijo de reserva: solo se usa si el área no tiene código, que la base no
#: permite pero un dato heredado sí podría traer.
PREFIJO_EMPLEADO = "EMP"


def _correlativo(prefijo: str) -> int:
    """Siguiente número libre dentro de un prefijo.

    Se calcula leyendo los códigos existentes, lo que no es atómico: dos altas
    simultáneas pueden proponer el mismo número. La restricción única de la
    base es la que lo garantiza de verdad; aquí solo se propone un valor
    razonable, y quien lo necesite puede escribir el suyo.

    Se recorren todos los del prefijo en vez de tomar el mayor por orden
    alfabético: «SIS-10» ordena antes que «SIS-9», así que el máximo de texto
    devolvería el número equivocado en cuanto el área pasara de nueve personas.
    """
    patron = re.compile(rf"^{re.escape(prefijo)}-(\d+)$")
    numeros = [
        int(coincidencia.group(1))
        for codigo in Empleado.objects.filter(
            codigo_empleado__startswith=f"{prefijo}-"
        ).values_list("codigo_empleado", flat=True)
        if (coincidencia := patron.match(codigo))
    ]
    return max(numeros, default=0) + 1


def generar_codigo_empleado(departamento=None) -> str:
    """Código con el área delante: `SIS-0001`, `CONT-0002`.

    Antes era un correlativo global —`EMP-0007`— que no decía nada de la
    persona: para saber de qué área era había que abrir su ficha. Con el código
    del área delante, el número que aparece en un acta de entrega, en una
    etiqueta o en la plantilla de carga ya ubica a quien responde por el
    equipo, y la numeración de cada área es independiente de las demás.
    """
    codigo_area = (getattr(departamento, "codigo", "") or "").strip().upper()
    prefijo = codigo_area or PREFIJO_EMPLEADO
    return f"{prefijo}-{_correlativo(prefijo):04d}"


class Departamento(ModeloDeEmpresa):
    """Área organizacional a la que se adscriben activos y empleados."""

    nombre = models.CharField(max_length=120)
    codigo = models.CharField(
        max_length=20,
        help_text="Identificador corto del área, usado en las etiquetas impresas.",
    )
    descripcion = models.TextField(blank=True)
    responsable = models.ForeignKey(
        "organizacion.Empleado",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="departamentos_a_cargo",
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "nombre"], name="departamento_nombre_unico_por_empresa"
            ),
            models.UniqueConstraint(
                fields=["empresa", "codigo"], name="departamento_codigo_unico_por_empresa"
            ),
        ]
        verbose_name = "departamento"
        verbose_name_plural = "departamentos"

    def __str__(self) -> str:
        return self.nombre


class Sede(ModeloDeEmpresa):
    """Edificio, local o ciudad donde la empresa tiene presencia.

    Era un texto dentro de cada ubicación, y ahí el problema no se veía hasta
    que el inventario crecía: «Sede Quito Norte», «sede quito norte» y «Quito
    Norte» son el mismo edificio para una persona y tres para una consulta.
    Como el traslado de un equipo se elige primero por sede, esas tres entradas
    parten el desplegable en tres listas incompletas y no hay forma de darse
    cuenta desde la pantalla.

    Con un catálogo propio, cambiar el nombre de una sede —una mudanza, un
    cambio de razón social— es una edición y no una búsqueda y reemplazo por
    todas las ubicaciones.
    """

    nombre = models.CharField(
        max_length=120,
        help_text="Cómo se la nombra internamente. Ej.: «Sede Quito Norte».",
    )
    ciudad = models.CharField(
        max_length=120,
        blank=True,
        help_text="Es lo que se muestra al decir dónde está un equipo. Ej.: «Quito».",
    )
    direccion = models.CharField(max_length=200, blank=True)

    class Region(models.TextChoices):
        SIERRA = "sierra", "Sierra"
        COSTA = "costa", "Costa"
        AMAZONIA = "amazonia", "Amazonía"
        INSULAR = "insular", "Insular"

    #: Región y provincia: el mantenimiento de sedes reporta por región y las
    #: órdenes se leen como «Quito · Sierra · Pichincha». Opcionales para que
    #: las sedes que ya existían no se rompan; se completan al editarlas.
    region = models.CharField(max_length=10, choices=Region.choices, blank=True)
    provincia = models.CharField(max_length=80, blank=True)
    #: Quienes responden por la sede: ven sus órdenes de mantenimiento y las
    #: aceptan al terminar (ver `apps.ordenes`). Una sede puede tener más de
    #: uno —titular y suplente— y una persona, más de una sede.
    responsables = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="sedes_a_cargo"
    )
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="sede_unica_por_empresa")
        ]
        verbose_name = "sede"
        verbose_name_plural = "sedes"

    def __str__(self) -> str:
        return self.nombre

    @property
    def donde(self) -> str:
        """Dónde está, para quien pregunta por un equipo.

        La ciudad, que es la respuesta útil —«está en Quito»—, con el nombre de
        la sede como respaldo: una sede sin ciudad rellenada dejaría el dato en
        blanco, y un hueco se lee como «no se sabe dónde está» cuando sí se
        sabe.
        """
        return self.ciudad.strip() or self.nombre


class Ubicacion(BaseModel):
    """Historia congelada: el nivel de bodega dentro de una sede, ya retirado.

    Aunque no se cree ni se edite desde ninguna pantalla, sus filas se leen: los
    movimientos anteriores al cambio las nombran. Por eso se acota igual que
    todo lo demás, por la sede a la que pertenecen.

    Un equipo se ubica ahora por **sede**, y dónde está se responde con su
    ciudad. Este segundo nivel obligaba a elegir dos veces en cada traslado y a
    inventar una bodega para cada sitio donde hubiera un equipo, con lo que el
    catálogo se llenaba de entradas como «Piso 1» que no dicen nada.

    El modelo se conserva porque los movimientos anteriores al cambio se
    registraron entre bodegas: borrarlo dejaría sin nombre traslados que
    alguien firmó. No se crea ni se edita desde ninguna pantalla.

    ---

    Lo que sigue es la razón por la que existió (§4.1 del documento funcional).

    Es un catálogo y no el texto libre que había antes porque «Bodega TI»,
    «bodega de TI» y «Bodega  TI» son el mismo sitio para una persona y tres
    para una consulta: con texto libre, filtrar el inventario por ubicación
    —que es lo que pide el §14— devuelve un tercio de los equipos que están
    ahí, y nadie nota lo que falta.

    Se separa del departamento a propósito: el área dice de quién es el
    presupuesto del equipo, la ubicación dice dónde ir a buscarlo. Un equipo
    de Contabilidad puede estar en la bodega de TI esperando reasignación.
    """

    class Tipo(models.TextChoices):
        """Qué es el sitio, no cómo se llama.

        Se guarda en vez de deducirlo del nombre porque «Bodega TI» y «Almacén
        de sistemas» son lo mismo y solo uno empieza por «bodega»: con la
        adivinanza, quien nombre sus bodegas a su manera las ve clasificadas
        como otra cosa y no tiene dónde corregirlo.
        """

        BODEGA = "bodega", "Bodega"
        OFICINA = "oficina", "Oficina"
        AREA = "area", "Área operativa"
        TALLER = "taller", "Taller o laboratorio"
        OTRO = "otro", "Otro"

    sede = models.ForeignKey(
        "organizacion.Sede",
        on_delete=models.PROTECT,
        related_name="ubicaciones",
        help_text="Edificio, local o ciudad. Se elige del catálogo de sedes.",
    )
    nombre = models.CharField(
        max_length=120,
        help_text="Lugar dentro de la sede. Ej.: «Bodega TI», «Oficina 302».",
    )
    tipo = models.CharField(
        max_length=20,
        choices=Tipo.choices,
        default=Tipo.BODEGA,
        help_text="En una bodega el equipo está guardado; en un área, en uso.",
    )
    detalle = models.CharField(
        max_length=150,
        blank=True,
        help_text="Precisión opcional: piso, ala, número de rack.",
    )
    activa = models.BooleanField(default=True)

    objects = gestor_de_lo_que_cuelga("sede__empresa")

    class Meta:
        ordering = ["sede__nombre", "nombre"]
        verbose_name = "ubicación"
        verbose_name_plural = "ubicaciones"
        # Dos ubicaciones con el mismo nombre en la misma sede serían
        # indistinguibles en el desplegable del formulario.
        constraints = [
            models.UniqueConstraint(fields=["sede", "nombre"], name="ubicacion_unica_por_sede")
        ]

    def __str__(self) -> str:
        return self.nombre_completo

    @property
    def nombre_completo(self) -> str:
        return f"{self.sede.nombre} · {self.nombre}" if self.sede_id else self.nombre

    @property
    def es_bodega(self) -> bool:
        return self.tipo == Ubicacion.Tipo.BODEGA


class Proveedor(ModeloDeEmpresa):
    """A quién se le compra: equipos y piezas de repuesto.

    Era un texto dentro de cada activo y no existía para los repuestos. Como
    texto libre, «Tecnomega», «TECNOMEGA» y «Tecno Mega» son la misma empresa
    para una persona y tres para una consulta: preguntar cuánto se le lleva
    comprado a un proveedor —o a quién reclamarle una pieza que falló a los dos
    meses— devuelve un tercio de lo que hay y nadie nota lo que falta.

    Lleva datos de contacto porque el momento en que se necesita el proveedor
    es justo cuando algo falló: sin un teléfono a mano, el dato de que la
    compra fue suya no sirve de nada. Es contacto comercial de la empresa
    —quién atiende la cuenta—, no información de un particular.
    """

    nombre = models.CharField(max_length=150)
    identificacion = models.CharField(
        max_length=20,
        blank=True,
        help_text="RUC o identificación tributaria de la empresa.",
    )
    contacto = models.CharField(
        max_length=120, blank=True, help_text="Persona que atiende la cuenta."
    )
    telefono = models.CharField(max_length=30, blank=True)
    correo = models.EmailField(blank=True)
    observaciones = models.TextField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "nombre"], name="proveedor_unico_por_empresa"
            )
        ]
        verbose_name = "proveedor"
        verbose_name_plural = "proveedores"

    def __str__(self) -> str:
        return self.nombre


class Concesionario(ModeloDeEmpresa):
    """El partner que pone equipos para operar con la empresa.

    **No es un proveedor, y la diferencia no es de matiz.** Un proveedor es a
    quien se le compró el equipo: la compra fue nuestra y el equipo es nuestro.
    Un concesionario es el dueño del equipo; lo pone para operar con nosotros,
    la compra corre por su cuenta y el mantenimiento por la nuestra. Guardarlos
    en el mismo catálogo mezclaría dos preguntas que se hacen por separado —«a
    quién le compramos» y «de quién es esto»— y volvería imposible la segunda,
    que es justo la que hay que responder al devolver el parque de un partner o
    al calcular cuánto vale lo que sí es de la empresa.

    Lleva datos de contacto por lo mismo que el proveedor: se lo necesita
    cuando algo falló, y un nombre sin teléfono no sirve para reclamar ni para
    coordinar una devolución.
    """

    nombre = models.CharField(max_length=150)
    identificacion = models.CharField(
        max_length=20,
        blank=True,
        help_text="RUC o identificación tributaria del partner.",
    )
    contacto = models.CharField(
        max_length=120, blank=True, help_text="Persona que atiende la relación."
    )
    telefono = models.CharField(max_length=30, blank=True)
    correo = models.EmailField(blank=True)
    observaciones = models.TextField(
        blank=True,
        help_text="Condiciones de la concesión: qué cubre cada parte, hasta cuándo.",
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "nombre"], name="concesionario_unico_por_empresa"
            )
        ]
        verbose_name = "concesionario"
        verbose_name_plural = "concesionarios"

    def __str__(self) -> str:
        return self.nombre


class Empleado(ModeloDeEmpresa):
    """Persona que puede tener activos bajo su custodia.

    No se elimina físicamente (`activo = False` en su lugar): un empleado que
    sale de la empresa sigue siendo el custodio histórico que aparece en los
    movimientos de sus equipos, y borrarlo dejaría ese historial sin nombre.

    Se identifica con un **código interno** y no con la cédula. El sistema solo
    necesita un identificador único y estable para saber quién custodia qué; la
    cédula es un dato personal de identificación que no aporta nada a esa
    finalidad y sí obligaría a protegerlo en la bitácora de auditoría —que es
    append-only— y en la plantilla de carga masiva, que se descarga y circula
    como archivo. Ver `docs/data-protection-review.md`.
    """

    nombres = models.CharField(max_length=120)
    apellidos = models.CharField(max_length=120)
    codigo_empleado = models.CharField(
        max_length=30,
        help_text=(
            "Identificador interno del empleado (ej. TI-0001: código del área y "
            "número dentro de ella). Se genera solo si se deja vacío."
        ),
    )
    correo = models.EmailField(blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    cargo = models.CharField(max_length=120, blank=True)
    departamento = models.ForeignKey(
        Departamento,
        on_delete=models.PROTECT,
        related_name="empleados",
    )
    # Obligatorio desde el 21/10/2026 (lo exige el alta, ver `cuentas.py`); la
    # columna admite nulos solo por los empleados anteriores sin usuario.
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="empleado",
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["apellidos", "nombres"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "codigo_empleado"], name="empleado_codigo_unico_por_empresa"
            )
        ]
        verbose_name = "empleado"
        verbose_name_plural = "empleados"
        indexes = [models.Index(fields=["apellidos", "nombres"])]

    def __str__(self) -> str:
        return self.nombre_completo

    def save(self, *args, **kwargs):
        if not self.codigo_empleado:
            self.codigo_empleado = generar_codigo_empleado(self.departamento)
        return super().save(*args, **kwargs)

    @property
    def nombre_completo(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()


class NivelJerarquico(ModeloDeEmpresa):
    """Un escalón del organigrama de la empresa (Presidencia, Gerencia,
    Departamento, Área…), en orden de arriba hacia abajo. Cada empresa define
    los suyos: no todas se organizan igual."""

    nombre = models.CharField(max_length=80)
    orden = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ["orden", "nombre"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "nombre"], name="nivel_jerarquico_nombre_unico_por_empresa"
            )
        ]
        verbose_name = "nivel jerárquico"
        verbose_name_plural = "niveles jerárquicos"

    def __str__(self) -> str:
        return self.nombre


class UnidadOrganizacional(ModeloDeEmpresa):
    """Un nodo del organigrama: una gerencia, un departamento, un área. Cuelga
    de otra unidad de un nivel superior (la raíz no cuelga de ninguna).

    Puede enlazarse a un Área (`Departamento`) de las que ya usan el
    inventario y la Mesa de ayuda, para no tener dos nombres de lo mismo."""

    nombre = models.CharField(max_length=150)
    codigo = models.CharField(max_length=20, blank=True)
    nivel = models.ForeignKey(NivelJerarquico, on_delete=models.PROTECT, related_name="unidades")
    padre = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="hijas"
    )
    departamento = models.ForeignKey(
        Departamento, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    descripcion = models.TextField(blank=True)
    activa = models.BooleanField(default=True)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["orden", "nombre"]
        verbose_name = "unidad organizacional"
        verbose_name_plural = "unidades organizacionales"

    def __str__(self) -> str:
        return self.nombre


class Cargo(ModeloDeEmpresa):
    """Un cargo del organigrama: pertenece a una unidad, reporta a otro cargo
    (su jefe inmediato) y tiene un número de plazas. Cada persona lo elige en
    «Mi perfil» o se lo asigna quien administra el organigrama.

    Un catálogo y no texto libre, por lo mismo que las sedes: «Analista de TI»
    y «analista TI» son el mismo cargo para una persona y dos para un reporte.
    El nombre se repite entre unidades («Asistente») y, dentro de una, bajo
    jefes distintos; no bajo el mismo jefe."""

    nombre = models.CharField(max_length=120)
    unidad = models.ForeignKey(
        UnidadOrganizacional,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="cargos",
    )
    jefe = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="subordinados"
    )
    plazas = models.PositiveSmallIntegerField(default=1)
    descripcion = models.TextField(blank=True)
    activo = models.BooleanField(default=True)
    # El perfil del cargo (perfiles_cargo.py): lo ve quien lo ocupa en «Mi
    # perfil». Funciones, competencias y KPIs, uno por línea.
    objetivo = models.TextField(blank=True)
    funciones = models.TextField(blank=True)
    competencias = models.TextField(blank=True)
    kpis = models.TextField(blank=True)
    #: El rol del sistema de este cargo (ver `roles_de_cargo`): lo comparten
    #: quienes lo ocupan y se crea, renombra y borra con el cargo.
    rol = models.OneToOneField(
        "auth.Group",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cargo_organigrama",
    )

    class Meta:
        ordering = ["nombre"]
        verbose_name = "cargo"
        verbose_name_plural = "cargos"

    def __str__(self) -> str:
        return self.nombre


class Herramienta(ModeloDeEmpresa):
    """Una herramienta o licencia que se usa en la empresa (herramientas.py):
    externa (Claude, Gmail…) o interna (Venture, Zimbra…)."""

    class Tipo(models.TextChoices):
        EXTERNA = "externa", "Externa"
        INTERNA = "interna", "Interna"

    nombre = models.CharField(max_length=120)
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.EXTERNA)
    descripcion = models.CharField(max_length=300, blank=True)
    activa = models.BooleanField(default=True)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["tipo", "orden", "nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="herramienta_unica")
        ]
        verbose_name = "herramienta"
        verbose_name_plural = "herramientas"

    def __str__(self) -> str:
        return self.nombre


class HerramientaDeUsuario(ModeloDeEmpresa):
    """Una herramienta que usa una persona, con la cuenta o usuario de su
    licencia. La declara ella en «Mi perfil»."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    herramienta = models.ForeignKey(Herramienta, on_delete=models.CASCADE, related_name="usos")
    cuenta = models.CharField(max_length=150, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "usuario", "herramienta"], name="herramienta_por_usuario_unica"
            )
        ]
        verbose_name = "herramienta de la persona"
        verbose_name_plural = "herramientas de las personas"


class HerramientaDeCargo(ModeloDeEmpresa):
    """Una herramienta base de un cargo: con la que, como mínimo, debe venir
    configurado el equipo de quien lo ocupa. La define TI."""

    cargo = models.ForeignKey(Cargo, on_delete=models.CASCADE, related_name="herramientas_base")
    herramienta = models.ForeignKey(
        Herramienta, on_delete=models.CASCADE, related_name="cargos_que_la_piden"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "cargo", "herramienta"], name="herramienta_base_unica"
            )
        ]
        verbose_name = "herramienta base del cargo"
        verbose_name_plural = "herramientas base de los cargos"


class OcupanteCargo(ModeloDeEmpresa):
    """Quien ocupa un cargo y todavía no tiene cuenta en el sistema
    (20/10/2026). Lo carga la plantilla masiva del organigrama
    (carga_personas.py); cuando la persona entra a la empresa con el mismo
    correo, recibe el cargo en su perfil y este registro se borra."""

    cargo = models.ForeignKey(Cargo, on_delete=models.CASCADE, related_name="ocupantes_sin_cuenta")
    nombres = models.CharField(max_length=150)
    apellidos = models.CharField(max_length=150)
    correo = models.EmailField(blank=True)

    class Meta:
        ordering = ["apellidos", "nombres"]
        verbose_name = "ocupante sin cuenta"
        verbose_name_plural = "ocupantes sin cuenta"

    def __str__(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()


class DatosDeContacto(ModeloDeEmpresa):
    """«Mi perfil»: el teléfono, el área y la agencia de una persona con cuenta
    en la empresa, que ella misma mantiene.

    Existe para quien no está en nómina (no tiene ficha de empleado) y para la
    agencia, que la ficha de empleado no guarda. La ficha de empleado de
    Talento Humano no se toca: de ella salen los valores iniciales.
    """

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="datos_de_contacto"
    )
    telefono = models.CharField(max_length=30, blank=True)
    departamento = models.ForeignKey(
        Departamento, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sede = models.ForeignKey(
        Sede, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    cargo = models.ForeignKey(
        Cargo, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    #: Su cumpleaños en el calendario de Inicio, si la persona lo decide
    #: (20/10/2026). Solo día y mes: el año no se guarda. Al dejar de
    #: mostrarlo se borran los dos.
    mostrar_cumpleanos = models.BooleanField(default=False)
    cumpleanos_dia = models.PositiveSmallIntegerField(null=True, blank=True)
    cumpleanos_mes = models.PositiveSmallIntegerField(null=True, blank=True)
    #: Cuándo aceptó que su cumpleaños sea visible para toda la empresa.
    cumpleanos_aceptado_en = models.DateTimeField(null=True, blank=True)
    #: Su correo personal, solo si lo pidió guardar y aceptó el tratamiento de
    #: datos (nomina: enviarse su rol de pagos). Al retirarlo se borra.
    correo_personal = models.EmailField(blank=True)
    correo_personal_aceptado_en = models.DateTimeField(null=True, blank=True)
    #: Su aniversario en la empresa, en el calendario de Inicio, si la persona
    #: lo decide (20/10/2026). Día y mes de ingreso; el año es opcional (con
    #: él se dicen los años cumplidos). Al dejar de mostrarlo se borran.
    mostrar_aniversario = models.BooleanField(default=False)
    aniversario_dia = models.PositiveSmallIntegerField(null=True, blank=True)
    aniversario_mes = models.PositiveSmallIntegerField(null=True, blank=True)
    aniversario_anio = models.PositiveSmallIntegerField(null=True, blank=True)
    aniversario_aceptado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["empresa", "usuario"], name="datos_de_contacto_unicos")
        ]


def ruta_documento(instance, filename: str) -> str:
    """Nombre generado, nunca el que trajo el archivo (el original se guarda
    aparte, para mostrarlo y descargarlo)."""
    return f"institucional/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class DocumentoInstitucional(ModeloDeEmpresa):
    """Un código de conducta, reglamento disciplinario u otra norma de la
    empresa, para que toda persona con cuenta lo lea (módulo Institucional →
    Códigos de conducta). Lo publica quien tiene `codigos.publicar`.

    Como los adjuntos, el archivo no se sirve como estático: se entrega por una
    vista que exige sesión y solo los documentos de la empresa activa.
    """

    class Categoria(models.TextChoices):
        CONDUCTA = "conducta", "Código de conducta"
        DISCIPLINARIO = "disciplinario", "Reglamento disciplinario"
        OTRO = "otro", "Otra norma"

    titulo = models.CharField(max_length=200)
    categoria = models.CharField(max_length=20, choices=Categoria.choices)
    descripcion = models.TextField(blank=True)
    version = models.CharField(max_length=30, blank=True)
    vigente_desde = models.DateField(null=True, blank=True)
    archivo = models.FileField(upload_to=ruta_documento, max_length=255)
    nombre_original = models.CharField(max_length=255)
    tamano_bytes = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100, blank=True)
    activo = models.BooleanField(default=True)
    #: El que se abre primero en «Códigos de conducta» (uno por empresa; si
    #: ninguno lo está, se abre el primero).
    predeterminado = models.BooleanField(default=False)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["categoria", "titulo"]
        verbose_name = "documento institucional"
        verbose_name_plural = "documentos institucionales"

    def __str__(self) -> str:
        return self.titulo

    @property
    def extension(self) -> str:
        return PurePath(self.nombre_original).suffix.lower()

    def borrar_archivo(self):
        if self.archivo:
            self.archivo.storage.delete(self.archivo.name)


class AcuerdoConfidencialidad(ModeloDeEmpresa):
    """El acuerdo de confidencialidad que se acepta antes de leer los códigos
    de conducta y reglamentos. Uno por empresa; título y texto los configura
    quien tiene `codigos.acuerdo`.

    `version_documentos` sube cada vez que se agrega, modifica o borra un
    documento: una aceptación vale para la versión en que se dio, así que
    cualquier cambio en los documentos obliga a aceptar de nuevo.
    """

    titulo = models.CharField(max_length=200)
    texto = models.TextField()
    version_documentos = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["empresa"], name="un_acuerdo_por_empresa")]
        verbose_name = "acuerdo de confidencialidad"
        verbose_name_plural = "acuerdos de confidencialidad"

    def __str__(self) -> str:
        return self.titulo


class AceptacionConfidencialidad(ModeloDeEmpresa):
    """Que una persona aceptó el acuerdo, cuándo y para qué versión de los
    documentos. No se sobrescribe: cada aceptación queda, con el texto que se
    aceptó, como constancia."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    version_documentos = models.PositiveIntegerField()
    aceptado_en = models.DateTimeField(auto_now_add=True)
    titulo_aceptado = models.CharField(max_length=200)
    texto_aceptado = models.TextField()

    class Meta:
        ordering = ["-aceptado_en"]
        indexes = [models.Index(fields=["usuario", "version_documentos"])]
        verbose_name = "aceptación de confidencialidad"
        verbose_name_plural = "aceptaciones de confidencialidad"


def ruta_noticia(instance, filename: str) -> str:
    return f"noticias/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class NoticiaInicio(ModeloDeEmpresa):
    """Una imagen del carrusel de Inicio: una noticia, aviso o evento que la
    empresa (Talento Humano) quiere que todos vean al entrar. Se muestra solo
    entre `publicar_desde` y `publicar_hasta`, ambos días incluidos."""

    titulo = models.CharField(max_length=150, blank=True)
    descripcion = models.CharField(max_length=300, blank=True)
    imagen = models.FileField(upload_to=ruta_noticia, max_length=255)
    nombre_original = models.CharField(max_length=255)
    tamano_bytes = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100, blank=True)
    publicar_desde = models.DateField()
    publicar_hasta = models.DateField()
    orden = models.PositiveSmallIntegerField(default=0)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["orden", "-publicar_desde", "id"]
        verbose_name = "noticia de inicio"
        verbose_name_plural = "noticias de inicio"

    def __str__(self) -> str:
        return self.titulo or self.nombre_original

    def borrar_imagen(self):
        if self.imagen:
            self.imagen.storage.delete(self.imagen.name)


class AjustesCarrusel(ModeloDeEmpresa):
    """Cada cuántos segundos cambia solo el carrusel de Inicio. Uno por
    empresa."""

    segundos = models.PositiveSmallIntegerField(default=6)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["empresa"], name="un_carrusel_por_empresa")]
        verbose_name = "ajustes del carrusel"
        verbose_name_plural = "ajustes del carrusel"


class EventoCalendario(ModeloDeEmpresa):
    """Una fecha del calendario de Inicio: un evento importante, un
    cumpleaños o un feriado. Puede durar varios días (`fecha_fin`) y repetirse
    cada año (`cada_anio`, lo normal en un cumpleaños)."""

    class Tipo(models.TextChoices):
        EVENTO = "evento", "Evento"
        CUMPLEANOS = "cumpleanos", "Cumpleaños"
        FERIADO = "feriado", "Feriado"

    titulo = models.CharField(max_length=150)
    tipo = models.CharField(max_length=20, choices=Tipo.choices, default=Tipo.EVENTO)
    fecha = models.DateField()
    fecha_fin = models.DateField(null=True, blank=True)
    descripcion = models.CharField(max_length=300, blank=True)
    cada_anio = models.BooleanField(default=False)
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["fecha", "titulo"]
        verbose_name = "evento del calendario"
        verbose_name_plural = "eventos del calendario"

    def __str__(self) -> str:
        return self.titulo


def ruta_aviso(instance, filename: str) -> str:
    return f"avisos/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class AvisoInicio(ModeloDeEmpresa):
    """El aviso importante que se muestra a toda persona al entrar al sistema
    tras iniciar sesión (una vez por sesión). Uno solo por empresa: título,
    imagen opcional y contenido. Se configura en Configuración → Aviso al
    iniciar sesión, con `configuracion.aviso_inicio`.

    `version` sube con cada cambio: quien ya lo cerró en esta sesión lo vuelve
    a ver si el aviso cambió."""

    activo = models.BooleanField(default=False)
    titulo = models.CharField(max_length=150, blank=True)
    contenido = models.TextField(blank=True)
    imagen = models.FileField(upload_to=ruta_aviso, max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["empresa"], name="un_aviso_de_inicio_por_empresa")
        ]
        verbose_name = "aviso al iniciar sesión"
        verbose_name_plural = "avisos al iniciar sesión"

    def __str__(self) -> str:
        return self.titulo or "Aviso al iniciar sesión"


class PeriodoVacaciones(ModeloDeEmpresa):
    """Un período de vacaciones de una persona: un año de servicio (`desde` a
    `hasta`) con los días que le corresponden. Lo gozado sale de sus goces;
    lo pendiente, de la resta."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    desde = models.DateField()
    hasta = models.DateField()
    dias_correspondientes = models.PositiveSmallIntegerField(default=15)
    nota = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["usuario", "-desde"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "usuario", "desde"], name="un_periodo_por_inicio"
            )
        ]
        verbose_name = "período de vacaciones"
        verbose_name_plural = "períodos de vacaciones"

    def __str__(self) -> str:
        return f"{self.desde.year}-{self.hasta.year}"


class GoceVacaciones(ModeloDeEmpresa):
    """Unos días de vacaciones gozados, a cuenta de un período."""

    periodo = models.ForeignKey(PeriodoVacaciones, on_delete=models.CASCADE, related_name="goces")
    desde = models.DateField()
    hasta = models.DateField()
    dias = models.PositiveSmallIntegerField()
    descripcion = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["desde"]
        verbose_name = "goce de vacaciones"
        verbose_name_plural = "goces de vacaciones"
