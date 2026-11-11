"""Solicitudes de derechos sobre datos personales (LOPDP de Ecuador), portadas
de `apps.data_requests` de Nexo (`DataSubjectRequest`, 09/11/2026) y ampliadas
a toda la intranet: cualquier persona con cuenta las pide desde «Mi perfil» y
cubren lo que la intranet guarda de ella en todos los módulos.

Dos modelos:

- `SolicitudDerechos`: la solicitud, con su tipo, su estado, la fecha límite
  para responderla, quién la resolvió y cuándo, y la última respuesta al
  titular.
- `MovimientoSolicitud`: cada cambio de estado con su respuesta u observación
  al titular. Append-only: es la constancia de cómo y cuándo se le respondió.

Lo que cambia frente a Nexo:

- **Multiempresa.** La solicitud hereda de `ModeloDeEmpresa`: se dirige a la
  empresa en la que la persona está trabajando cuando la pide. Cada empresa del
  grupo es un responsable del tratamiento distinto (su propio RUC), y lo que la
  intranet guarda de la persona en una empresa lo atiende quien tiene el permiso
  en esa empresa. Quien trabaja en varias pide una en cada una (ver
  `docs/derechos-sobre-datos.md`). El movimiento cuelga de la solicitud.
- **Fecha límite.** Se calcula al crearla con el plazo vigente
  (`settings.PRIVACIDAD_PLAZO_DIAS`) y se guarda: si el plazo se cambia
  mañana, las solicitudes ya recibidas conservan el que se les comunicó.
- **RECHAZADA.** Nexo solo tenía PENDIENTE, EN_PROCESO y RESUELTA. Una
  eliminación puede no proceder (hay datos que la empresa debe conservar por
  ley: el rol de pagos, la auditoría); responderla «resuelta» confundiría al
  titular, y la LOPDP pide motivar la negativa. Por eso existe y exige
  respuesta.
- **Respuesta al titular.** Nexo solo cambiaba el estado; aquí cada cierre
  lleva el texto que lee el titular.
- **Nada irreversible automático.** Como en Nexo, una ELIMINACION no borra
  nada: quien atiende la gestiona a mano (baja lógica de la cuenta, depuración
  puntual) y deja constancia en la respuesta.
- **`on_delete`.** El titular es `PROTECT` (en Nexo, CASCADE): las cuentas de
  la intranet no se borran (baja lógica), y una solicitud es la constancia de
  que se ejerció un derecho; no debe desaparecer con nadie.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa

DESCRIPCION_MAX = 2000
RESPUESTA_MAX = 4000


class SolicitudDerechos(ModeloDeEmpresa):
    class Tipo(models.TextChoices):
        ACCESO = "ACCESO", "Acceso a mis datos"
        RECTIFICACION = "RECTIFICACION", "Corrección de datos"
        ELIMINACION = "ELIMINACION", "Eliminación de datos"

    class Estado(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        EN_PROCESO = "EN_PROCESO", "En proceso"
        RESUELTA = "RESUELTA", "Resuelta"
        RECHAZADA = "RECHAZADA", "Rechazada"

    #: Los estados en los que la solicitud ya tiene respuesta.
    FINALES = (Estado.RESUELTA, Estado.RECHAZADA)

    titular = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="solicitudes_de_derechos", on_delete=models.PROTECT
    )
    tipo = models.CharField(max_length=20, choices=Tipo.choices)
    descripcion = models.TextField(blank=True, default="")
    estado = models.CharField(max_length=15, choices=Estado.choices, default=Estado.PENDIENTE)
    #: Hasta cuándo hay para responder (fin de ese día, hora de Ecuador).
    fecha_limite = models.DateField()
    #: Los días del plazo con que se calculó `fecha_limite`.
    plazo_dias = models.PositiveSmallIntegerField()
    #: La última respuesta u observación al titular (la de cada cambio está en
    #: el historial).
    respuesta = models.TextField(blank=True, default="")
    resuelta_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="+",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
    )
    resuelta_en = models.DateTimeField(null=True, blank=True)
    #: El id que tenía en Nexo, si vino de allí (`importar_nexo_privacidad`).
    #: Evita importarla dos veces.
    id_nexo = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["empresa", "estado", "fecha_limite"]),
            models.Index(fields=["titular", "created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "id_nexo"],
                condition=models.Q(id_nexo__isnull=False),
                name="privacidad_una_por_id_de_nexo",
            )
        ]

    def __str__(self) -> str:
        # Sin la descripción: un `str()` termina en logs y en el admin.
        return f"Solicitud {self.pk} ({self.tipo})"

    @property
    def numero(self) -> str:
        return f"LOPDP-{self.pk:05d}" if self.pk else ""

    @property
    def cerrada(self) -> bool:
        return self.estado in self.FINALES


class MovimientoSolicitud(BaseModel):
    """Un cambio de estado. Append-only: nunca se edita ni se borra."""

    solicitud = models.ForeignKey(
        SolicitudDerechos, related_name="movimientos", on_delete=models.CASCADE
    )
    estado_anterior = models.CharField(
        max_length=15, choices=SolicitudDerechos.Estado.choices, blank=True
    )
    estado_nuevo = models.CharField(max_length=15, choices=SolicitudDerechos.Estado.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    #: Lo que se le dice al titular con este cambio (puede ir vacío al pasar a
    #: EN_PROCESO).
    respuesta = models.TextField(blank=True, default="")

    objects = gestor_de_lo_que_cuelga("solicitud__empresa")

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.solicitud_id}: {self.estado_anterior} -> {self.estado_nuevo}"


# ── Consentimiento del tratamiento de datos (09/11/2026) ──────────────────────
#
# Portado del «gate» de consentimiento de Nexo (`ConsentGate.tsx`,
# `User.data_consent_accepted[_at]`, el texto editable `consent_text` y el
# restablecer individual y masivo). Lo que cambia, y por qué, está en
# `consentimiento.py`.

AVISO_MAX = 20000


class AvisoPrivacidad(ModeloDeEmpresa):
    """El aviso de tratamiento de datos que cada persona acepta al entrar. Uno
    por empresa (cada empresa es un responsable del tratamiento distinto).

    `version` sube solo cuando quien administra la privacidad pide aceptarlo de
    nuevo: corregir una coma no obliga a todos a aceptar otra vez; un cambio
    sustancial, sí. Sin aviso en la empresa no se exige nada."""

    texto = models.TextField()
    version = models.PositiveIntegerField(default=1)
    #: Desde cuándo rige la versión actual (cuándo se pidió aceptarla).
    version_desde = models.DateTimeField()
    editado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["empresa"], name="privacidad_un_aviso_por_empresa")
        ]
        verbose_name = "aviso de privacidad"
        verbose_name_plural = "avisos de privacidad"

    def __str__(self) -> str:
        return f"Aviso de privacidad v{self.version}"


class AceptacionAviso(ModeloDeEmpresa):
    """Una aceptación del aviso: quién, qué versión, cuándo, desde qué IP y el
    texto exacto que leyó. Es la constancia legal: no se borra ni se edita,
    salvo para marcarla restablecida (`restablecida_en`), que la deja sin
    efecto sin perderla."""

    class Origen(models.TextChoices):
        INTRANET = "INTRANET", "Intranet"
        NEXO = "NEXO", "Nexo (importada)"

    #: La versión con que se registran las aceptaciones traídas de Nexo.
    VERSION_NEXO = "Nexo"

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="aceptaciones_de_aviso", on_delete=models.PROTECT
    )
    #: «1», «2»… para las de la intranet; «Nexo» para las importadas.
    version = models.CharField(max_length=20)
    origen = models.CharField(max_length=10, choices=Origen.choices, default=Origen.INTRANET)
    aceptado_en = models.DateTimeField()
    ip = models.GenericIPAddressField(null=True, blank=True)
    #: El texto que se mostró al aceptar (vacío si no se conoce: Nexo).
    texto = models.TextField(blank=True, default="")
    restablecida_en = models.DateTimeField(null=True, blank=True)
    restablecida_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    #: El id del usuario en Nexo, si vino de allí (`importar_nexo_consentimiento`).
    id_nexo = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-aceptado_en", "-id"]
        indexes = [models.Index(fields=["empresa", "usuario", "version"])]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "id_nexo", "aceptado_en"],
                condition=models.Q(id_nexo__isnull=False),
                name="privacidad_una_aceptacion_por_nexo",
            )
        ]
        verbose_name = "aceptación del aviso de privacidad"
        verbose_name_plural = "aceptaciones del aviso de privacidad"

    def __str__(self) -> str:
        return f"Aceptación {self.pk} (v{self.version})"


# ── Textos de protección de datos y sus aceptaciones (US-004, 11/11/2026) ─────
#
# Hasta hoy cada módulo guardaba su texto y su constancia a su manera: el aviso
# aquí, la autorización del teléfono en `organizacion.TextoLegal` y en cuatro
# columnas de `DatosDeContacto`, los términos del rol de pagos en `nomina`, el
# acuerdo de confidencialidad en `organizacion`, y el cumpleaños, el
# aniversario, los derechos y los avisos de Nova fijos en el frontend. Desde
# US-004 todos viven en un catálogo (`TextoProteccion`; la lista cerrada de
# claves está en `catalogo_textos.py`) y todas las aceptaciones en un registro
# común (`AceptacionTexto`). Los modelos de antes no se borran en esta
# historia (decisión del 11/11/2026): `privacidad/0007` copia sus datos y se
# dejan de usar, para poder volver atrás.


class TextoProteccion(ModeloDeEmpresa):
    """Un texto sobre datos personales que la intranet muestra, por empresa
    (cada empresa es un responsable del tratamiento distinto). Uno por clave.

    `modulo`, `seccion` y `nombre` se copian del catálogo al crearlo: así la
    pantalla y el Excel de aceptaciones agrupan con una sola consulta, y un
    texto cuya clave saliera del catálogo seguiría identificado.

    `version` sube con cada cambio del texto (o del título). `version_exigida`
    es la versión más antigua cuya aceptación sigue valiendo: la mayoría de los
    textos la igualan a `version` en cada cambio (hay que aceptar de nuevo),
    pero el aviso general solo la sube si se marca «Pedir aceptarlo de nuevo»
    (CA-3): corregir una coma no obliga a todos. Los que no piden aceptación
    la llevan igual a `version`."""

    clave = models.SlugField(max_length=60)
    modulo = models.CharField(max_length=80)
    seccion = models.CharField(max_length=80)
    nombre = models.CharField(max_length=150)
    #: Su posición en el catálogo, para listarlo siempre en el mismo orden.
    orden = models.PositiveSmallIntegerField(default=0)
    requiere_aceptacion = models.BooleanField(default=False)
    #: Solo lo usa el acuerdo de confidencialidad.
    titulo = models.CharField(max_length=200, blank=True, default="")
    texto = models.TextField()
    version = models.PositiveIntegerField(default=1)
    version_exigida = models.PositiveIntegerField(default=1)
    #: La última edición; vacío mientras rige el texto con que se sembró.
    editado_en = models.DateTimeField(null=True, blank=True)
    editado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="+",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    class Meta:
        ordering = ["orden", "clave"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "clave"], name="privacidad_un_texto_por_clave"
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1), name="privacidad_texto_version_positiva"
            ),
            # La versión exigida no puede ser una que todavía no existe.
            models.CheckConstraint(
                condition=models.Q(version_exigida__gte=1)
                & models.Q(version_exigida__lte=models.F("version")),
                name="privacidad_texto_version_exigida_valida",
            ),
        ]
        verbose_name = "texto de protección de datos"
        verbose_name_plural = "textos de protección de datos"

    def __str__(self) -> str:
        return f"{self.nombre} (v{self.version})"


class VersionTextoProteccion(BaseModel):
    """Cada versión de un texto, también la vigente: lo que decía, quién la
    guardó, cuándo y por qué. Append-only. Sirve para ver versiones anteriores
    y para saber qué decía la versión que alguien aceptó cuando la aceptación
    no guarda el texto."""

    texto_proteccion = models.ForeignKey(
        TextoProteccion, related_name="versiones", on_delete=models.PROTECT
    )
    version = models.PositiveIntegerField()
    titulo = models.CharField(max_length=200, blank=True, default="")
    texto = models.TextField()
    editado_en = models.DateTimeField()
    editado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="+",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    motivo = models.CharField(max_length=300, blank=True, default="")

    objects = gestor_de_lo_que_cuelga("texto_proteccion__empresa")

    class Meta:
        ordering = ["texto_proteccion", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["texto_proteccion", "version"], name="privacidad_una_fila_por_version"
            )
        ]
        verbose_name = "versión de un texto de protección de datos"
        verbose_name_plural = "versiones de los textos de protección de datos"

    def __str__(self) -> str:
        return f"{self.texto_proteccion_id} v{self.version}"


class AceptacionTexto(ModeloDeEmpresa):
    """Una aceptación de un texto del catálogo: quién, qué versión, el texto
    exacto, cuándo, desde qué IP y navegador, y de dónde vino. Es la constancia
    legal (CA-4): no se sobrescribe ni se borra. Retirar una autorización
    (teléfono, cumpleaños, aniversario, correo) llena `retirada_en`;
    restablecer el aviso general (la administración pide que la persona lo
    acepte otra vez) llena `restablecida_en`. Las dos dejan la fila sin efecto
    sin perderla; se distinguen porque una la decide el titular y la otra la
    administración.

    Cuelga del texto por FK y no por la clave: agrupar por módulo y sección es
    un `select_related`, y la base garantiza que no hay aceptaciones de un
    texto que no existe. El texto nunca se borra (`PROTECT`), así que la FK no
    pone en riesgo la constancia. La persona también es `PROTECT`, como en
    `AceptacionAviso`: las cuentas no se borran (baja lógica)."""

    class Origen(models.TextChoices):
        INTRANET = "INTRANET", "Intranet"
        NEXO = "NEXO", "Nexo (importada)"
        #: De una fuente que solo guardaba la fecha (cumpleaños, aniversario,
        #: correo personal): sin IP ni texto (CA-6).
        MIGRADA = "MIGRADA", "Migrada (solo fecha)"

    texto_proteccion = models.ForeignKey(
        TextoProteccion, related_name="aceptaciones", on_delete=models.PROTECT
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="aceptaciones_de_textos", on_delete=models.PROTECT
    )
    #: La versión aceptada. `None` si no se conoce (importada de Nexo, o el
    #: correo personal migrado, cuyo consentimiento no tenía versión).
    version = models.PositiveIntegerField(null=True, blank=True)
    #: Lo que se mostró al aceptar, tal cual. Vacío si no se conoce.
    texto_aceptado = models.TextField(blank=True, default="")
    titulo_aceptado = models.CharField(max_length=200, blank=True, default="")
    aceptado_en = models.DateTimeField(db_index=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    navegador = models.CharField(max_length=300, blank=True, default="")
    origen = models.CharField(max_length=10, choices=Origen.choices, default=Origen.INTRANET)
    retirada_en = models.DateTimeField(null=True, blank=True)
    retirada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    restablecida_en = models.DateTimeField(null=True, blank=True)
    restablecida_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", null=True, blank=True, on_delete=models.PROTECT
    )
    #: De dónde sale la fila: «nomina.ConsultaRolPagos:<id>» para cada consulta
    #: del rol, o la fila de origen de las migradas
    #: («privacidad.AceptacionAviso:<id>», «organizacion.DatosDeContacto:<id>:telefono»…).
    #: Única por texto cuando no está vacía: la migración no copia dos veces.
    referencia = models.CharField(max_length=80, blank=True, default="")
    #: El id del usuario en Nexo, si vino de allí (como en `AceptacionAviso`).
    id_nexo = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-aceptado_en", "-id"]
        indexes = [
            # El listado de «Aceptaciones» de la empresa, del más reciente.
            models.Index(fields=["empresa", "aceptado_en"], name="privacidad_acep_emp_fecha"),
            # El listado filtrado por texto (o por módulo, que es un conjunto
            # de textos), del más reciente.
            models.Index(
                fields=["texto_proteccion", "aceptado_en"], name="privacidad_acep_texto_fecha"
            ),
            # «¿Aceptó esta persona la versión vigente?»: se pregunta en cada
            # pantalla que pide aceptación, y el filtro por persona.
            models.Index(
                fields=["usuario", "texto_proteccion", "aceptado_en"],
                name="privacidad_acep_usu_texto",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["texto_proteccion", "referencia"],
                # «referencia > ''» y no «NOT (referencia = '')»: los índices
                # filtrados de SQL Server no admiten NOT.
                condition=models.Q(referencia__gt=""),
                name="privacidad_acep_una_por_referencia",
            ),
            models.UniqueConstraint(
                fields=["texto_proteccion", "id_nexo", "aceptado_en"],
                condition=models.Q(id_nexo__isnull=False),
                name="privacidad_acep_una_por_nexo",
            ),
            models.CheckConstraint(
                condition=models.Q(version__isnull=True) | models.Q(version__gte=1),
                name="privacidad_acep_version_positiva",
            ),
        ]
        verbose_name = "aceptación de un texto de protección de datos"
        verbose_name_plural = "aceptaciones de los textos de protección de datos"

    def __str__(self) -> str:
        return f"Aceptación {self.pk} (v{self.version})"

    @property
    def vigente(self) -> bool:
        """Sin retirar ni restablecer. Si vale para la versión exigida lo dice
        el servicio, que conoce la regla de cada texto."""
        return self.retirada_en is None and self.restablecida_en is None
