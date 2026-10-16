"""Las notificaciones de la campana.

Cada aviso que el sistema le manda a una persona con cuenta —por correo o
solo dentro del sistema— le deja además una notificación: de qué módulo viene,
un resumen y el enlace a lo que la originó. Así no depende del correo para
enterarse, y si el SMTP falla, la campana igual lo tiene.
"""

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


class Notificacion(ModeloDeEmpresa):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notificaciones_campana"
    )
    #: El módulo de origen (`apps.notificaciones.modulos.MODULOS`).
    modulo = models.CharField(max_length=30)
    #: Qué la disparó: la clave de la plantilla de correo o del evento.
    tipo = models.CharField(max_length=60)
    titulo = models.CharField(max_length=150)
    resumen = models.CharField(max_length=300, blank=True)
    #: Ruta interna del sistema (empieza con «/»); vacía si no hay a dónde ir.
    enlace = models.CharField(max_length=300, blank=True)
    leida_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["usuario", "leida_en"])]

    def __str__(self):
        return self.titulo
