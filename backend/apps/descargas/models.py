"""Registro de descargas (26/10/2026, pedido de la administración).

Cada vez que una persona —cualquiera— guarda en su equipo un archivo del
sistema (pulsa «Descargar»), queda quién, qué archivo, cuándo, desde qué IP y
una copia exacta para auditarlo. Ver el archivo en pantalla no cuenta.

- `ArchivoServido`: lo que el servidor entregó (lo anota el middleware), con
  su huella. Sirve para comprobar que lo que el navegador dice que guardó es
  lo mismo que se le entregó, y para saber de dónde salió. Dura dos días.
- `CopiaArchivo`: la copia de un archivo, una por huella (el mismo archivo
  descargado cien veces se guarda una vez).
- `Descarga`: el registro de cada descarga.
- **Los roles de pagos no se copian** (sus términos dicen que el documento no
  se guarda): queda el mes, el código, la huella y todo lo demás, y se vuelven
  a generar desde nómina.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.models import ModeloDeEmpresa


class ArchivoServido(models.Model):
    """Un archivo que entregó la API, con su huella (lo anota el middleware)."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, related_name="+"
    )
    ruta = models.CharField(max_length=300)
    sha256 = models.CharField(max_length=64, db_index=True)
    tamano = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=120, blank=True)
    nombre = models.CharField(max_length=255, blank=True)
    #: Lo que la vista dijo de él (`marcar`): p. ej. el mes y el código de un
    #: rol de pagos, y si no se copia.
    referencia = models.JSONField(default=dict, blank=True)
    creado = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-creado"]


def ruta_copia(instance, filename: str) -> str:
    return f"descargas/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()[:10]}"


class CopiaArchivo(BaseModel):
    """La copia de un archivo descargado: una por huella."""

    sha256 = models.CharField(max_length=64, unique=True)
    archivo = models.FileField(upload_to=ruta_copia, max_length=255)
    tamano = models.PositiveBigIntegerField(default=0)
    #: La última vez que alguien descargó este mismo archivo: las copias se
    #: borran un año después de eso.
    ultima_vez = models.DateTimeField()


class Descarga(ModeloDeEmpresa):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    nombre = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    tamano = models.PositiveBigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    navegador = models.CharField(max_length=300, blank=True)
    #: La pantalla desde la que se descargó (ruta del frontend).
    pantalla = models.CharField(max_length=300, blank=True)
    modulo = models.CharField(max_length=60, blank=True, db_index=True)
    #: De dónde lo entregó el servidor, si se comprobó (`verificada`).
    origen = models.CharField(max_length=300, blank=True)
    #: La huella coincide con un archivo que entregó el servidor a esa
    #: persona. Si no, el archivo se armó en el navegador o no se pudo cotejar.
    verificada = models.BooleanField(default=False)
    copia = models.ForeignKey(
        CopiaArchivo, on_delete=models.SET_NULL, null=True, blank=True, related_name="descargas"
    )
    #: Por qué no hay copia («rol de pagos», «demasiado grande», «vencida»).
    sin_copia = models.CharField(max_length=120, blank=True)
    referencia = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "descarga"
        verbose_name_plural = "descargas"


class ResumenDescargas(ModeloDeEmpresa):
    """Marca que ya se avisó el resumen de un día (uno por empresa y día)."""

    fecha = models.DateField()
    total = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "fecha"], name="un_resumen_descargas_por_dia"
            )
        ]
