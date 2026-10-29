"""Consultar rol de pagos (módulo Institucional, 20/10/2026).

Cada persona consulta su rol de pagos de un año y mes. El código de empleado
sale de su sesión (no se escribe). Para verlo acepta, en cada consulta, unos
términos parametrizables («soy el propietario de este rol…») y confirma con la
contraseña de su cuenta. El PDF se arma al vuelo desde un procedimiento
almacenado y **no se guarda**; si lo envía a su correo personal, se vuelve a
generar. Cuando la persona acepta su rol, sus datos sí quedan guardados como
constancia (`RolAceptado`, 26/10/2026) y ese mes ya sale de ahí. Talento Humano consulta el de otras personas con
`roles_pago.consultar_todos`.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.empresas.models import ModeloDeEmpresa

TERMINOS_POR_DEFECTO = (
    "Declaro que soy el titular del rol de pagos que voy a consultar y que la "
    "información que contiene es personal y confidencial. Me comprometo a no "
    "compartirla con terceros. Entiendo que esta consulta queda registrada con "
    "su fecha, hora y dirección de red, y que, si acepto mi rol de pagos, el rol "
    "que acepté queda guardado como constancia."
)
#: El texto por defecto hasta el 26/10/2026, cuando el rol aceptado empezó a
#: guardarse (la migración 0006 lo cambia si nadie lo había personalizado).
TERMINOS_ANTERIORES = (
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

#: El aviso del primer día hábil (aviso del rol de pagos, 29/10/2026): los
#: textos por defecto. `{mes}`, `{anio}` y `{dias}` se reemplazan al mostrarlo
#: (`aviso.py`).
AVISO_TITULO_POR_DEFECTO = "Su rol de pagos ya está disponible"
AVISO_MENSAJE_POR_DEFECTO = (
    "Su rol de pagos de {mes} de {anio} ya está disponible para que lo revise. "
    "Ábralo, verifique que los valores sean correctos y acéptelo; si encuentra "
    "algo que no está bien, deje una observación."
)
AVISO_TITULO_VENCIDO_POR_DEFECTO = "Plazo vencido para aceptar su rol de pagos"
AVISO_MENSAJE_VENCIDO_POR_DEFECTO = (
    "Superó los {dias} días hábiles permitidos para aceptar su rol de pagos de "
    "{mes} de {anio}. Exceder este plazo puede ser motivo de sanción. Revíselo y "
    "acéptelo cuanto antes; si encuentra algo que no está bien, deje una "
    "observación."
)
AVISO_DIAS_POR_DEFECTO = 3
AVISO_DIAS_MAXIMO = 20


class ConfiguracionRolPagos(ModeloDeEmpresa):
    """Los textos de la consulta, por empresa: los términos que se aceptan en
    cada consulta y el consentimiento para guardar el correo personal. Cada
    cambio de los términos sube su versión. También el aviso que sale al
    iniciar sesión desde el primer día hábil del mes hasta que la persona
    acepta su rol del mes anterior (aviso del rol de pagos, 29/10/2026)."""

    terminos = models.TextField(default=TERMINOS_POR_DEFECTO)
    version = models.PositiveIntegerField(default=1)
    consentimiento_correo = models.TextField(default=CONSENTIMIENTO_CORREO_POR_DEFECTO)
    aviso_activo = models.BooleanField(default=True)
    aviso_titulo = models.CharField(max_length=150, default=AVISO_TITULO_POR_DEFECTO)
    aviso_mensaje = models.TextField(default=AVISO_MENSAJE_POR_DEFECTO)
    aviso_titulo_vencido = models.CharField(
        max_length=150, default=AVISO_TITULO_VENCIDO_POR_DEFECTO
    )
    aviso_mensaje_vencido = models.TextField(default=AVISO_MENSAJE_VENCIDO_POR_DEFECTO)
    #: Cuántos días hábiles, desde el primero del mes, tiene para aceptarlo
    #: antes de que el aviso pase a decir que el plazo venció.
    aviso_dias_habiles = models.PositiveSmallIntegerField(
        default=AVISO_DIAS_POR_DEFECTO,
        validators=[MinValueValidator(1), MaxValueValidator(AVISO_DIAS_MAXIMO)],
    )

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
    #: La huella de los datos del rol que mostró (no el rol): al aceptarlo se
    #: comprueba que nómina no lo cambió desde entonces (`aceptado.py`).
    huella_rol = models.CharField(max_length=64, blank=True)

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


class RolAceptado(ModeloDeEmpresa):
    """El rol de pagos que la persona aceptó (26/10/2026): sus datos —rubros
    y montos, no el PDF— tal como los vio. Desde entonces ese mes sale de
    aquí y no de nómina, y la aceptación es definitiva. Uno por código y mes.
    Lo ven la persona y Talento Humano con permiso (`aceptado.py`)."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    codigo_empleado = models.CharField(max_length=40)
    anio = models.PositiveSmallIntegerField()
    mes = models.PositiveSmallIntegerField()
    consulta = models.OneToOneField(
        ConsultaRolPagos, on_delete=models.PROTECT, related_name="rol_aceptado"
    )
    datos = models.JSONField()
    huella = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "codigo_empleado", "anio", "mes"],
                name="un_rol_aceptado_por_codigo_y_mes",
            )
        ]
        verbose_name = "rol de pagos aceptado"
        verbose_name_plural = "roles de pagos aceptados"


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


def ruta_adjunto_observacion(instance, filename: str) -> str:
    """Nombre generado, nunca el que trajo el archivo (el original se guarda
    aparte para la descarga)."""
    return f"nomina/observaciones/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class AdjuntoObservacion(ModeloDeEmpresa):
    """Una imagen o un archivo que Talento Humano adjuntó a su respuesta de
    una observación (22/10/2026): queda en el historial con la respuesta. No
    se sirve como archivo público: se descarga por la API, con permiso."""

    mensaje = models.ForeignKey(
        MensajeObservacion, on_delete=models.CASCADE, related_name="adjuntos"
    )
    archivo = models.FileField(upload_to=ruta_adjunto_observacion, max_length=255)
    nombre_original = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    tamano = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["id"]
        verbose_name = "adjunto de una observación"
        verbose_name_plural = "adjuntos de las observaciones"
