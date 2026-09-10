"""Adjuntos y evidencias de los activos (§18 del documento funcional).

Todo adjunto pertenece a un activo, y opcionalmente a una de sus
intervenciones: es lo que permite que la factura, el acta de entrega y el
informe técnico de una reparación concreta convivan en la misma ficha sin
mezclarse.

Los archivos **no se sirven como estáticos**. Se guardan fuera del árbol
público y se entregan por una vista que exige permiso y deja traza: un
inventario de TI acumula facturas, actas firmadas y fotos de equipos, y una
URL adivinable bastaría para sacarlas todas sin pasar por el login.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga

#: Extensiones aceptadas. Lista cerrada, no una lista de prohibidas: lo
#: segundo obliga a acertar con todo lo que podría ejecutarse en el futuro.
EXTENSIONES_PERMITIDAS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx", ".xlsx"}

#: 10 MB. Suficiente para un acta escaneada o varias fotos de un equipo, y
#: lejos de convertir el disco del servidor en un almacén de archivos.
TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024

#: Firmas de archivo por extensión, para comprobar que el contenido es lo que
#: dice la extensión. No es un antivirus: evita el caso corriente de subir un
#: ejecutable renombrado a `.pdf`.
FIRMAS = {
    ".pdf": [b"%PDF-"],
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".webp": [b"RIFF"],
    # docx y xlsx son contenedores ZIP; los dos primeros bytes son los de ZIP.
    ".docx": [b"PK\x03\x04", b"PK\x05\x06"],
    ".xlsx": [b"PK\x03\x04", b"PK\x05\x06"],
}


def ruta_adjunto(instance, filename: str) -> str:
    """Ruta de almacenamiento: nombre generado, nunca el que trajo el archivo.

    Un nombre de archivo que viene del cliente puede traer separadores, `..`,
    caracteres que el sistema de archivos interprete o, sencillamente, chocar
    con otro. El original se conserva aparte, como metadato para la descarga.
    """
    extension = PurePath(filename).suffix.lower()
    return f"adjuntos/{instance.activo_id}/{uuid.uuid4().hex}{extension}"


class Adjunto(BaseModel):
    """Un documento o evidencia asociado a un activo."""

    class Tipo(models.TextChoices):
        FACTURA = "factura", "Factura de compra"
        ACTA_ENTREGA = "acta_entrega", "Acta de entrega"
        ACTA_DEVOLUCION = "acta_devolucion", "Acta de devolución"
        FOTO = "foto", "Foto del equipo"
        INFORME_TECNICO = "informe_tecnico", "Informe técnico"
        COTIZACION = "cotizacion", "Cotización de reparación"
        GARANTIA = "garantia", "Garantía"
        DOCUMENTO_BAJA = "documento_baja", "Documento de baja"
        EVIDENCIA_DANO = "evidencia_dano", "Evidencia de daño"

    activo = models.ForeignKey("activos.Activo", on_delete=models.CASCADE, related_name="adjuntos")
    mantenimiento = models.ForeignKey(
        "mantenimientos.Mantenimiento",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="adjuntos",
        help_text="Intervención concreta a la que pertenece, si aplica.",
    )
    tipo = models.CharField(max_length=20, choices=Tipo.choices)
    archivo = models.FileField(upload_to=ruta_adjunto, max_length=255)
    nombre_original = models.CharField(
        max_length=255, help_text="Nombre con el que se subió, para devolverlo al descargar."
    )
    tamano_bytes = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100, blank=True)
    descripcion = models.CharField(max_length=255, blank=True)
    generado_por_el_sistema = models.BooleanField(
        default=False,
        help_text="Actas y documentos que produce el propio sistema, no cargados por alguien.",
    )
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="adjuntos_subidos",
    )

    #: La empresa la pone el activo del que es evidencia.
    objects = gestor_de_lo_que_cuelga("activo__empresa")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "adjunto"
        verbose_name_plural = "adjuntos"
        indexes = [
            models.Index(fields=["activo", "tipo"]),
        ]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} - {self.nombre_original}"

    @property
    def extension(self) -> str:
        return PurePath(self.nombre_original).suffix.lower()

    def borrar_archivo(self):
        """Elimina el fichero del disco sin tocar la fila.

        Se llama antes de borrar el registro: si se hiciera al revés y algo
        fallara, quedaría el archivo huérfano ocupando espacio sin nada que
        lo referencie.
        """
        if self.archivo:
            self.archivo.storage.delete(self.archivo.name)
