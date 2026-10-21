"""Matriz de obligaciones: el módulo que controla las obligaciones
regulatorias, contractuales e internas de cada empresa.

Se construye sobre lo que el sistema ya tiene —usuarios, empresas y su
membresía con roles, catálogo de permisos, auditoría, correo, adjuntos y la
tarea programada— y agrega solo lo propio de la matriz. La especificación
completa está en `matriz_admin/docs/modulo/MODULO-MATRIZ-OBLIGACIONES.md`; los
números de sección de los comentarios remiten a ella.

Fase 1: los catálogos compartidos. Fase 2: obligaciones, períodos, la
secuencia de códigos y el historial. Fase 3: las evidencias. Fase 4: la
configuración de los recordatorios y las notificaciones.
"""

import datetime

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa


class _Catalogo(BaseModel):
    """Áreas y entidades de control (§4.3).

    **Compartidos por todas las empresas**, a diferencia de los catálogos del
    inventario: el SRI o el IESS son los mismos para LaarCourier que para
    LaarSeguridad, y un reporte de cumplimiento por entidad tiene que poder
    sumar las de todo el grupo sin emparejar nombres escritos de dos formas.
    Por eso heredan de `BaseModel` y no de `ModeloDeEmpresa`.
    """

    codigo = models.CharField(max_length=10, unique=True)

    class Meta:
        abstract = True
        ordering = ["nombre"]

    def __str__(self) -> str:
        return f"{self.codigo} — {self.nombre}"


class Area(_Catalogo):
    """Tema de la Matriz: Ambiental, Seguros y Pólizas, Talento Humano…

    Se llamaba «Área» y se confundía con las áreas del organigrama, que son las
    que organizan personas y equipos de cada empresa. Desde el 21/10/2026 se
    muestra como «Tema»: clasifica obligaciones y se comparte entre empresas.
    El modelo y la API conservan el nombre `area` para no romper datos ni
    enlaces.
    """

    nombre = models.CharField(max_length=120)
    #: Áreas donde puede **crear** obligaciones quien no ve toda la empresa
    #: (§4.4, §8.7). Cuelga de la membresía del sistema: es el mismo «quién
    #: trabaja dónde», con lo que la Matriz necesita encima. Vacío = cualquiera.
    membresias = models.ManyToManyField(
        "empresas.MembresiaEmpresa", blank=True, related_name="areas_matriz"
    )

    class Meta(_Catalogo.Meta):
        verbose_name = "tema"
        verbose_name_plural = "temas"


class EntidadControl(_Catalogo):
    """Quien exige la obligación: SRI, IESS, Ministerio del Trabajo…"""

    nombre = models.CharField(max_length=160)

    class Meta(_Catalogo.Meta):
        verbose_name = "entidad de control"
        verbose_name_plural = "entidades de control"


# --- Listas cerradas (§5) -------------------------------------------------


class Tipo(models.TextChoices):
    REGULATORIA = "regulatoria", "Regulatoria"
    CONTRACTUAL = "contractual", "Contractual"
    INTERNA = "interna", "Interna"


class Periodicidad(models.TextChoices):
    MENSUAL = "mensual", "Mensual"
    TRIMESTRAL = "trimestral", "Trimestral"
    SEMESTRAL = "semestral", "Semestral"
    ANUAL = "anual", "Anual"
    # Permisos y contratos que se renuevan cada varios años (21/10/2026).
    BIENAL = "bienal", "Bienal (cada 2 años)"
    TRIENAL = "trienal", "Trienal (cada 3 años)"
    QUINQUENAL = "quinquenal", "Quinquenal (cada 5 años)"
    DECENAL = "decenal", "Decenal (cada 10 años)"
    UNICA = "unica", "Única"


#: Las que vencen un día y mes fijos del año en que les toca.
DE_DIA_Y_MES = {
    Periodicidad.ANUAL,
    Periodicidad.BIENAL,
    Periodicidad.TRIENAL,
    Periodicidad.QUINQUENAL,
    Periodicidad.DECENAL,
}


class Prioridad(models.TextChoices):
    ALTA = "alta", "Alta"
    MEDIA = "media", "Media"
    BAJA = "baja", "Baja"


class Etapa(models.TextChoices):
    SIN_INICIAR = "sin_iniciar", "Sin iniciar"
    EN_PREPARACION = "en_preparacion", "En preparación"
    PENDIENTE_VALIDACION = "pendiente_validacion", "Pendiente de validación"


# --- Obligación y período ---------------------------------------------------


class Obligacion(ModeloDeEmpresa):
    """La plantilla de un deber recurrente: «Declaración de IVA» (§4.5).

    Cada vencimiento concreto es un `Periodo`. Desactivarla deja de generar
    períodos nuevos sin tocar los que ya existen.
    """

    nombre = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True)
    area = models.ForeignKey(Area, on_delete=models.PROTECT, related_name="obligaciones")
    entidad = models.ForeignKey(
        EntidadControl, on_delete=models.PROTECT, related_name="obligaciones"
    )
    tipo = models.CharField(max_length=12, choices=Tipo.choices, default=Tipo.REGULATORIA)
    periodicidad = models.CharField(max_length=12, choices=Periodicidad.choices)
    fundamento_legal = models.TextField(blank=True)
    fundamento_url = models.URLField(max_length=500, blank=True)
    evidencia_esperada = models.CharField(
        max_length=255, help_text="Ej.: «Formulario 104 y comprobante de pago»."
    )
    dia_vencimiento = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    mes_vencimiento = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(12)],
        help_text="Solo para las anuales.",
    )
    hora_vencimiento = models.TimeField(default=datetime.time(17, 0))
    prioridad_defecto = models.CharField(
        max_length=6, choices=Prioridad.choices, default=Prioridad.MEDIA
    )
    activa = models.BooleanField(default=True)
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["nombre"]
        verbose_name = "obligación"
        verbose_name_plural = "obligaciones"
        constraints = [
            # El nombre no se repite en una empresa. La intercalación de SQL
            # Server no distingue mayúsculas, así que «IVA» e «iva» chocan
            # aquí también; el serializador lo dice antes, con un mensaje claro.
            models.UniqueConstraint(
                fields=["empresa", "nombre"], name="obligacion_nombre_unico_por_empresa"
            )
        ]

    def __str__(self) -> str:
        return self.nombre


class SecuenciaCodigo(models.Model):
    """El contador de los códigos `OBL-0001` (§4.6).

    Global y no por empresa: el código identifica un período en todo el grupo,
    en un correo o en una conversación, sin tener que decir de qué empresa es.
    Se incrementa con bloqueo de fila (ver `servicios.siguiente_codigo`).
    """

    nombre = models.CharField(max_length=30, unique=True)
    ultimo_valor = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "secuencia de códigos"
        verbose_name_plural = "secuencias de códigos"


class Periodo(ModeloDeEmpresa):
    """Cada vencimiento concreto de una obligación, con su código (§4.7).

    El **estado** —incumplido, en progreso, finalizado— no se guarda: se
    calcula en cada consulta con la hora de la empresa (ver `estados.py`). Lo
    que se guarda es lo que alguien decidió: la etapa, el avance, el cierre.
    """

    codigo = models.CharField(max_length=20, unique=True)
    obligacion = models.ForeignKey(Obligacion, on_delete=models.PROTECT, related_name="periodos")
    #: La sucursal: las sedes de Organización (decisión del mapa de
    #: integración), no una entidad aparte.
    sede = models.ForeignKey(
        "organizacion.Sede",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="periodos_matriz",
    )
    etiqueta = models.CharField(max_length=60)
    fecha_inicio = models.DateField()
    fecha_preparacion = models.DateField()
    vence_en = models.DateTimeField(db_index=True)
    responsable = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="periodos_responsable"
    )
    suplente = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="periodos_suplente",
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="periodos_supervisor",
    )
    aprobador = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="periodos_aprobador",
    )
    prioridad = models.CharField(max_length=6, choices=Prioridad.choices, default=Prioridad.MEDIA)
    avance = models.PositiveSmallIntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    etapa = models.CharField(max_length=24, choices=Etapa.choices, default=Etapa.SIN_INICIAR)
    observaciones = models.TextField(blank=True)
    enviado_en = models.DateTimeField(null=True, blank=True)
    enviado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    cerrado = models.BooleanField(default=False, db_index=True)
    cumplido_en = models.DateTimeField(null=True, blank=True)
    validado_en = models.DateTimeField(null=True, blank=True)
    validado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    recordatorios_suspendidos = models.BooleanField(default=False)

    class Meta:
        ordering = ["vence_en"]
        verbose_name = "período"
        verbose_name_plural = "períodos"

    def __str__(self) -> str:
        return f"{self.codigo} · {self.obligacion} ({self.etiqueta})"


class EventoPeriodo(BaseModel):
    """Una línea del historial de un período (§4.9).

    **Solo inserción**: no se edita ni se borra, porque es lo que se mira el día
    que hay que reconstruir quién hizo qué. Sin actor, lo hizo el sistema.
    """

    periodo = models.ForeignKey(Periodo, on_delete=models.CASCADE, related_name="eventos")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    accion = models.CharField(max_length=60)
    descripcion = models.CharField(max_length=255)
    motivo = models.TextField(blank=True)
    valor_anterior = models.CharField(max_length=255, blank=True)
    valor_nuevo = models.CharField(max_length=255, blank=True)

    #: Se ve desde la empresa de su período, y desde ninguna otra.
    objects = gestor_de_lo_que_cuelga("periodo__empresa")

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "evento del período"
        verbose_name_plural = "historial de períodos"
        indexes = [models.Index(fields=["created_at"])]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValueError("El historial es de solo inserción: no se edita.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("El historial es de solo inserción: no se borra.")


# --- Evidencias (fase 3) ---------------------------------------------------


def ruta_evidencia(instance, filename: str) -> str:
    """`evidencias/{empresa}/{año del vencimiento}/{código}/v{versión}-{sha}.pdf`
    (§4.8).

    Nunca el nombre que trajo el archivo: puede traer separadores, `..` o
    chocar con otro. El original se guarda aparte, para mostrarlo y descargarlo.
    """
    periodo = instance.periodo
    return (
        f"evidencias/{periodo.empresa.codigo}/{periodo.vence_en.year}/{periodo.codigo}/"
        f"v{instance.version}-{instance.sha256[:12]}.pdf"
    )


class EstadoDocumento(models.TextChoices):
    VALIDO = "valido", "Válido"
    RECHAZADO = "rechazado", "Rechazado"
    ELIMINADO = "eliminado", "Eliminado"


class Documento(BaseModel):
    """Un PDF que respalda el cumplimiento de un período (§4.8).

    **Nada se borra físicamente**: eliminar un documento rechazado lo marca
    como eliminado y el archivo se conserva. «Con evidencia» cuenta solo los
    válidos; un período con solo rechazados sigue pendiente.
    """

    periodo = models.ForeignKey(Periodo, on_delete=models.PROTECT, related_name="documentos")
    archivo = models.FileField(upload_to=ruta_evidencia, max_length=255)
    nombre_original = models.CharField(max_length=255)
    #: Volver a subir un archivo con el mismo nombre en el período (sin
    #: distinguir mayúsculas) es una versión nueva, no un reemplazo.
    version = models.PositiveIntegerField(default=1)
    tamano = models.BigIntegerField()
    content_type = models.CharField(max_length=100, default="application/pdf")
    sha256 = models.CharField(max_length=64)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    estado = models.CharField(
        max_length=10, choices=EstadoDocumento.choices, default=EstadoDocumento.VALIDO
    )
    motivo_rechazo = models.TextField(blank=True)
    rechazado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    rechazado_en = models.DateTimeField(null=True, blank=True)
    eliminado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    eliminado_en = models.DateTimeField(null=True, blank=True)

    #: Se ve desde la empresa de su período, y desde ninguna otra.
    objects = gestor_de_lo_que_cuelga("periodo__empresa")

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "documento de evidencia"
        verbose_name_plural = "documentos de evidencia"

    def __str__(self) -> str:
        return f"{self.nombre_original} (v{self.version})"


# --- Recordatorios (fase 4) ------------------------------------------------


def anticipaciones_por_defecto() -> list[int]:
    return [15, 7, 3, 1, 0]


class ConfiguracionRecordatorios(BaseModel):
    """Cuándo y a quién avisa la Matriz en una empresa (§4.10).

    Una por empresa, creada con los valores por defecto la primera vez que se
    lee. El día del vencimiento (0) siempre está en las anticipaciones: sin él,
    el aviso más importante dependería de que alguien se acordara de ponerlo.
    """

    empresa = models.OneToOneField(
        "empresas.Empresa", on_delete=models.CASCADE, related_name="recordatorios_matriz"
    )
    anticipaciones = models.JSONField(default=anticipaciones_por_defecto)
    hora_envio = models.TimeField(default=datetime.time(8, 0))
    copia_suplente = models.BooleanField(default=True)
    escalamiento_activo = models.BooleanField(default=True)
    dias_escalamiento = models.PositiveSmallIntegerField(
        default=2, validators=[MinValueValidator(1), MaxValueValidator(30)]
    )
    #: 0 = escalar una sola vez; N = repetir cada N días.
    repetir_escalamiento_cada = models.PositiveSmallIntegerField(
        default=0, validators=[MaxValueValidator(30)]
    )

    objects = gestor_de_lo_que_cuelga("empresa")

    class Meta:
        verbose_name = "configuración de recordatorios"
        verbose_name_plural = "configuraciones de recordatorios"

    def __str__(self) -> str:
        return f"Recordatorios de {self.empresa}"


class TipoNotificacion(models.TextChoices):
    RECORDATORIO = "recordatorio", "Recordatorio"
    VENCIMIENTO = "vencimiento", "Día del vencimiento"
    ESCALAMIENTO = "escalamiento", "Escalamiento"
    MANUAL = "manual", "Manual"


class EstadoNotificacion(models.TextChoices):
    ENVIADO = "enviado", "Enviado"
    FALLIDO = "fallido", "Fallido"
    REINTENTADO = "reintentado", "Reintentado"


class Notificacion(BaseModel):
    """Un aviso a una persona sobre un período (§4.11).

    `clave` es única y es lo que impide los duplicados (§12.4): la fila se crea
    **antes** de enviar, así que dos pasadas del programador a la vez chocan en
    la base y solo una manda el correo. Si el proceso muere entre crear la fila
    y enviar, la fila queda fallida y el reintento la recoge.
    """

    periodo = models.ForeignKey(Periodo, on_delete=models.CASCADE, related_name="notificaciones")
    tipo = models.CharField(max_length=12, choices=TipoNotificacion.choices)
    #: Días de anticipación; negativo = días de atraso en un escalamiento.
    anticipacion = models.SmallIntegerField(null=True, blank=True)
    destinatario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="notificaciones_matriz",
    )
    correo = models.EmailField()
    #: El día local de la empresa al que corresponde el aviso.
    programada_para = models.DateField()
    estado = models.CharField(max_length=12, choices=EstadoNotificacion.choices)
    intentos = models.PositiveSmallIntegerField(default=1)
    ultimo_error = models.TextField(blank=True)
    enviado_en = models.DateTimeField(null=True, blank=True)
    reintento_de = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="reintentos"
    )
    disparado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    clave = models.CharField(max_length=200, unique=True)

    objects = gestor_de_lo_que_cuelga("periodo__empresa")

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "notificación"
        verbose_name_plural = "notificaciones"
        indexes = [models.Index(fields=["estado", "intentos"])]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} a {self.correo} ({self.periodo.codigo})"
