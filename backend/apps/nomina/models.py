"""Consultar rol de pagos (módulo Institucional, 20/10/2026).

Cada persona consulta su rol de pagos de un año y mes. El código de empleado
sale de su sesión (no se escribe). Para verlo acepta, en cada consulta, unos
términos parametrizables («soy el propietario de este rol…») y confirma con la
contraseña de su cuenta. El PDF se arma al vuelo desde un procedimiento
almacenado y **no se guarda**; si lo envía a su correo personal, se vuelve a
generar. Talento Humano consulta el de otras personas con
`roles_pago.consultar_todos`.
"""

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa

TERMINOS_POR_DEFECTO = (
    "Declaro que soy el titular del rol de pagos que voy a consultar y que la "
    "información que contiene es personal y confidencial. Me comprometo a no "
    "compartirla con terceros. Entiendo que esta consulta queda registrada con "
    "su fecha, hora y dirección de red."
)
CONSENTIMIENTO_CORREO_POR_DEFECTO = (
    "Autorizo a la empresa a guardar mi correo personal para enviarme mis roles de "
    "pagos cuando lo solicite, conforme a la Ley Orgánica de Protección de Datos "
    "Personales. Puedo retirarlo cuando quiera."
)


class ConfiguracionRolPagos(ModeloDeEmpresa):
    """Los textos de la consulta, por empresa: los términos que se aceptan en
    cada consulta y el consentimiento para guardar el correo personal. Cada
    cambio de los términos sube su versión."""

    terminos = models.TextField(default=TERMINOS_POR_DEFECTO)
    version = models.PositiveIntegerField(default=1)
    consentimiento_correo = models.TextField(default=CONSENTIMIENTO_CORREO_POR_DEFECTO)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["empresa"], name="una_configuracion_rol_por_empresa")
        ]
        verbose_name = "configuración del rol de pagos"
        verbose_name_plural = "configuraciones del rol de pagos"


class ConsultaRolPagos(ModeloDeEmpresa):
    """Constancia de cada consulta: quién, de qué código y período, qué texto
    aceptó (tal cual) y desde dónde. Nunca guarda montos ni el PDF."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    codigo_empleado = models.CharField(max_length=40)
    anio = models.PositiveSmallIntegerField()
    mes = models.PositiveSmallIntegerField()
    version_terminos = models.PositiveIntegerField()
    terminos_aceptados = models.TextField()
    ip = models.GenericIPAddressField(null=True, blank=True)
    navegador = models.CharField(max_length=300, blank=True)
    envios = models.PositiveSmallIntegerField(default=0)

    class Conformidad(models.TextChoices):
        CONFORME = "conforme", "Estuvo de acuerdo"
        AL_CERRAR = "conforme_al_cerrar", "Aceptó al cerrar sin responder"
        OBSERVACION = "observacion", "Dejó una observación"

    #: Si la persona está de acuerdo con su rol (una vez por consulta). Cerrar
    #: el visor sin responder cuenta como conforme, y queda dicho así.
    conformidad = models.CharField(max_length=20, choices=Conformidad.choices, blank=True)
    conformidad_en = models.DateTimeField(null=True, blank=True)
    #: Desde dónde se respondió (puede no ser desde donde se consultó).
    conformidad_ip = models.GenericIPAddressField(null=True, blank=True)
    conformidad_navegador = models.CharField(max_length=300, blank=True)
    observacion = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "consulta del rol de pagos"
        verbose_name_plural = "consultas del rol de pagos"


class ObservacionRolPagos(ModeloDeEmpresa):
    """Una observación de una persona a su rol de pagos de un mes: la atiende
    Talento Humano (`roles_pago.observaciones`), que la corrige y le pide que
    vuelva a confirmar. Se cierra cuando la persona dice que está de acuerdo;
    si vuelve a observar, se reabre. Una por persona y período."""

    class Estado(models.TextChoices):
        ABIERTA = "abierta", "Por atender"
        CORREGIDA = "corregida", "Corregida, por confirmar"
        CERRADA = "cerrada", "Confirmada"

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    codigo_empleado = models.CharField(max_length=40)
    anio = models.PositiveSmallIntegerField()
    mes = models.PositiveSmallIntegerField()
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.ABIERTA)
    corregida_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    corregida_en = models.DateTimeField(null=True, blank=True)
    cerrada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "observación al rol de pagos"
        verbose_name_plural = "observaciones al rol de pagos"


class MensajeObservacion(ModeloDeEmpresa):
    """El historial de una observación: lo que dijo la persona, las
    correcciones de Talento Humano y la confirmación."""

    class Tipo(models.TextChoices):
        OBSERVACION = "observacion", "Observación"
        CORRECCION = "correccion", "Corrección"
        CONFIRMACION = "confirmacion", "Confirmó que está de acuerdo"

    observacion = models.ForeignKey(
        ObservacionRolPagos, on_delete=models.CASCADE, related_name="mensajes"
    )
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    tipo = models.CharField(max_length=12, choices=Tipo.choices)
    texto = models.TextField(blank=True)

    class Meta:
        ordering = ["created_at", "id"]
