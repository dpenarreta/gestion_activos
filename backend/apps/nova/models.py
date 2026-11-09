"""El registro de uso de Nova: solo metadatos, nunca el contenido.

Una fila por cada vez que una función pidió a Nova un texto: quién, qué
función, con qué proveedor y modelo, cuántos tokens, cuánto tardó y cómo terminó. Ni el
pedido ni la respuesta se guardan (decisión del 09/11/2026). Sirve para el
límite diario por persona (`limites.py`) y para ver el costo.

No hereda de `ModeloDeEmpresa`: el límite es por persona en todo el sistema,
y el filtro automático por empresa lo partiría. Los documentos de la base de
conocimiento sí son de cada empresa (`ModeloDeEmpresa`).
"""

import uuid

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


class UsoNova(models.Model):
    class Resultado(models.TextChoices):
        CON_IA = "con_ia", "Respondió la IA"
        FALLO = "fallo", "La IA falló o tardó (versión sin IA)"
        SIN_CLAVE = "sin_clave", "IA no configurada (versión sin IA)"
        SIN_CONSENTIMIENTO = "sin_consentimiento", "Sin aceptar el aviso de datos (versión sin IA)"
        LIMITE = "limite", "Límite diario alcanzado (versión sin IA)"
        BLOQUEADO = "bloqueado", "Bloqueado por privacidad antes de enviar (versión sin IA)"
        #: Chat General con «Responder solo con las fuentes»: la búsqueda no
        #: encontró fragmentos y no se llamó a la IA (no cuenta para el límite).
        SIN_FUENTES = "sin_fuentes", "Sin fragmentos en la base de conocimiento (no se llamó)"

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="+", on_delete=models.CASCADE
    )
    #: La función que pidió el texto (`kpi`, `informe`, `inicio`, `chat`…).
    funcion = models.CharField(max_length=40)
    #: «anthropic» o «gemini» (vacío si no se llegó a elegir proveedor).
    proveedor = models.CharField(max_length=20, blank=True, default="")
    modelo = models.CharField(max_length=80, blank=True, default="")
    tokens_entrada = models.PositiveIntegerField(default=0)
    tokens_salida = models.PositiveIntegerField(default=0)
    exito = models.BooleanField(default=False)
    resultado = models.CharField(max_length=20, choices=Resultado.choices)
    #: Si se llegó a llamar al proveedor (lo único que cuenta para el límite).
    llamada = models.BooleanField(default=False)
    duracion_ms = models.PositiveIntegerField(default=0)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-creado"]
        indexes = [models.Index(fields=["usuario", "creado"])]
        verbose_name = "uso de Nova"
        verbose_name_plural = "usos de Nova"

    def __str__(self) -> str:
        return f"{self.usuario_id}:{self.funcion}:{self.resultado}"


# ── Base de conocimiento ─────────────────────────────────────────────────────


def ruta_documento(instance, filename: str) -> str:
    """Nombre generado, nunca el que trajo el archivo (el original se guarda
    aparte, para mostrarlo)."""
    return f"nova/conocimiento/{uuid.uuid4().hex}.pdf"


class DocumentoConocimiento(ModeloDeEmpresa):
    """Un PDF de la base de conocimiento de Nova (políticas, reglamentos,
    procedimientos de la empresa). Nexo los guardaba en GitHub y los buscaba
    con embeddings de Google; aquí el archivo va al almacenamiento de la
    intranet y el texto extraído, troceado en `FragmentoConocimiento`, se
    busca con una búsqueda léxica en el servidor (`conocimiento.py`): no sale
    hacia ningún proveedor hasta que el chat elige los fragmentos relevantes.

    Como los demás archivos, no se sirve como estático: lo entrega una vista
    que exige sesión, permiso y la empresa activa (y se abre en el visor del
    sistema).
    """

    titulo = models.CharField(max_length=200)
    archivo = models.FileField(upload_to=ruta_documento, max_length=255)
    nombre_original = models.CharField(max_length=255)
    tamano_bytes = models.PositiveIntegerField()
    paginas = models.PositiveIntegerField(default=0)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["titulo"]
        verbose_name = "documento de la base de conocimiento"
        verbose_name_plural = "documentos de la base de conocimiento"

    def __str__(self) -> str:
        return self.titulo

    def borrar_archivo(self) -> None:
        if self.archivo:
            self.archivo.storage.delete(self.archivo.name)


class FragmentoConocimiento(ModeloDeEmpresa):
    """Un trozo del texto de un documento (unos 1800 caracteres, con 200 de
    solape con el anterior de la misma página). `terminos` es el texto ya
    normalizado (sin tildes, en minúsculas, sin palabras vacías) que usa la
    búsqueda. Ninguna vista los lista a quien solo puede ver los documentos
    (en Nexo bastaba la sesión)."""

    documento = models.ForeignKey(
        DocumentoConocimiento, related_name="fragmentos", on_delete=models.CASCADE
    )
    orden = models.PositiveIntegerField()
    pagina = models.PositiveIntegerField()
    texto = models.TextField()
    terminos = models.TextField()

    class Meta:
        ordering = ["documento", "orden"]
        verbose_name = "fragmento de la base de conocimiento"
        verbose_name_plural = "fragmentos de la base de conocimiento"

    def __str__(self) -> str:
        return f"{self.documento_id}:{self.orden}"
