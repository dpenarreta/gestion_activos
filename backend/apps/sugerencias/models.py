"""Sugerencias y reporte de errores (módulo Institucional, 20/10/2026).

Cualquier persona con cuenta envía una **sugerencia** (una mejora o algo nuevo)
o reporta un **error** del sistema, con el módulo donde ocurre, una
descripción y, si quiere, una captura. Sigue sus reportes y conversa sobre
ellos. Quien tiene `sugerencias.gestionar` ve todos, los clasifica por estado
y responde; cada cambio se avisa en la campana.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


def ruta_captura(instance, filename: str) -> str:
    return f"sugerencias/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class Reporte(ModeloDeEmpresa):
    """Una sugerencia o un error reportado."""

    class Tipo(models.TextChoices):
        SUGERENCIA = "sugerencia", "Sugerencia"
        ERROR = "error", "Error del sistema"

    class Impacto(models.TextChoices):
        BAJO = "bajo", "Bajo: es una molestia, se puede seguir trabajando"
        MEDIO = "medio", "Medio: hay que dar un rodeo para seguir"
        ALTO = "alto", "Alto: no deja trabajar"

    class Estado(models.TextChoices):
        NUEVO = "nuevo", "Nuevo"
        EN_REVISION = "en_revision", "En revisión"
        PLANIFICADO = "planificado", "Planificado"
        RESUELTO = "resuelto", "Resuelto"
        DESCARTADO = "descartado", "Descartado"

    tipo = models.CharField(max_length=12, choices=Tipo.choices)
    titulo = models.CharField(max_length=150)
    descripcion = models.TextField()
    modulo = models.CharField(max_length=40)
    #: Solo en los errores.
    impacto = models.CharField(max_length=6, choices=Impacto.choices, blank=True)
    captura = models.FileField(upload_to=ruta_captura, max_length=255, blank=True)
    captura_tipo = models.CharField(max_length=50, blank=True)
    autor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.NUEVO)
    cerrado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "sugerencia o error"
        verbose_name_plural = "sugerencias y errores"

    def __str__(self) -> str:
        return f"#{self.pk} {self.titulo}"


class ComentarioReporte(ModeloDeEmpresa):
    """Un mensaje de la conversación de un reporte, o un cambio de estado."""

    reporte = models.ForeignKey(Reporte, on_delete=models.CASCADE, related_name="comentarios")
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    texto = models.TextField(blank=True)
    #: Si el mensaje acompaña un cambio de estado, a cuál pasó.
    estado_nuevo = models.CharField(max_length=12, choices=Reporte.Estado.choices, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "comentario del reporte"
        verbose_name_plural = "comentarios del reporte"
