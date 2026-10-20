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

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "consulta del rol de pagos"
        verbose_name_plural = "consultas del rol de pagos"
