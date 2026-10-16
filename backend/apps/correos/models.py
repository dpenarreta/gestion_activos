"""La versión personalizada de un correo del sistema.

Solo existe la fila cuando alguien cambió el diseño o el asunto desde
Configuración: sin ella se usa el del catálogo (`catalogo.py`). Restablecer es
borrar la fila. Es configuración general, de todas las empresas, como la
identidad visual.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class PlantillaCorreo(BaseModel):
    #: La clave del correo en el catálogo (`acceso.recuperar_contrasena`…).
    clave = models.CharField(max_length=60, unique=True)
    asunto = models.CharField(max_length=255)
    html = models.TextField()
    actualizado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["clave"]
        verbose_name = "plantilla de correo"
        verbose_name_plural = "plantillas de correo"

    def __str__(self) -> str:
        return self.clave
