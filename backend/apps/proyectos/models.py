"""Solicitud de proyectos (módulo Institucional, 26/10/2026).

Cada **tipo de proyecto** («Solicitud de proyecto», «Proyecto de TI»…) tiene:

- una **plantilla** (Word, Excel o PDF) que quien solicita descarga, llena y
  vuelve a cargar con su solicitud;
- su **formulario**: los campos que se piden al solicitar, que se agregan,
  quitan y ordenan, cada uno obligatorio u opcional;
- sus **pasos**, en orden (de inicio: Aprobación → Autorización → Revisión),
  con quién decide cada uno: el jefe inmediato según el organigrama, una
  persona, las personas de un rol o quien ocupe un cargo. Con varios en un
  paso, decide cualquiera.

Una **solicitud** recorre los pasos de su tipo como una solicitud de permiso
(`apps.licencias`): queda pendiente de quienes deciden el paso en curso, que
la aprueban (pasa al siguiente), la rechazan (el proyecto no se inicia) o la
escalan. Aprobado el último paso, el proyecto se puede iniciar. Cada
movimiento queda en su historial.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa
from apps.licencias.models import _ConDestino
from apps.soporte.models import CampoFormulario

#: Los tipos de campo son los del formulario de Soporte TI (texto, párrafo,
#: número, fecha, lista, casilla, correo, teléfono): se validan igual.
TipoCampo = CampoFormulario.Tipo


def ruta_plantilla(instance, filename: str) -> str:
    return f"proyectos/plantillas/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


def ruta_archivo(instance, filename: str) -> str:
    return f"proyectos/solicitudes/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class TipoProyecto(ModeloDeEmpresa):
    """Un tipo de proyecto que se puede solicitar: su plantilla, su formulario
    y sus pasos. Solo se activa con plantilla y con al menos un paso."""

    nombre = models.CharField(max_length=120)
    descripcion = models.TextField(blank=True)
    activo = models.BooleanField(default=False)
    orden = models.PositiveSmallIntegerField(default=0)
    plantilla = models.FileField(upload_to=ruta_plantilla, max_length=255, blank=True)
    plantilla_nombre = models.CharField(max_length=255, blank=True)
    plantilla_tipo = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["orden", "nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="tipo_proyecto_unico")
        ]
        verbose_name = "tipo de proyecto"
        verbose_name_plural = "tipos de proyecto"

    def __str__(self) -> str:
        return self.nombre


class CampoProyecto(ModeloDeEmpresa):
    """Un campo del formulario de un tipo de proyecto."""

    tipo_proyecto = models.ForeignKey(TipoProyecto, on_delete=models.CASCADE, related_name="campos")
    etiqueta = models.CharField(max_length=120)
    tipo = models.CharField(max_length=10, choices=TipoCampo.choices, default=TipoCampo.TEXTO)
    #: Las opciones de una lista.
    opciones = models.JSONField(default=list, blank=True)
    obligatorio = models.BooleanField(default=False)
    ayuda = models.CharField(max_length=300, blank=True)
    orden = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "campo del formulario de proyecto"
        verbose_name_plural = "campos del formulario de proyecto"

    def __str__(self) -> str:
        return self.etiqueta

    @property
    def clave(self) -> str:
        """Con qué nombre llega su respuesta al solicitar."""
        return f"c{self.pk}"


class PasoProyecto(ModeloDeEmpresa):
    """Un paso (aprobación, autorización, revisión…), en el orden en que se
    recorre."""

    tipo_proyecto = models.ForeignKey(TipoProyecto, on_delete=models.CASCADE, related_name="pasos")
    orden = models.PositiveSmallIntegerField(default=1)
    nombre = models.CharField(max_length=120)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "paso del tipo de proyecto"
        verbose_name_plural = "pasos del tipo de proyecto"

    def __str__(self) -> str:
        return self.nombre


class AprobadorPasoProyecto(_ConDestino):
    """Quién decide un paso. Con varios, decide cualquiera."""

    paso = models.ForeignKey(PasoProyecto, on_delete=models.CASCADE, related_name="aprobadores")

    class Meta:
        verbose_name = "quien decide el paso"
        verbose_name_plural = "quienes deciden el paso"


class SolicitudProyecto(ModeloDeEmpresa):
    """Una solicitud de proyecto y en qué paso va."""

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "En aprobación"
        APROBADA = "aprobada", "Aprobada: se inicia"
        RECHAZADA = "rechazada", "Rechazada: no se inicia"
        CANCELADA = "cancelada", "Cancelada"

    numero = models.CharField(max_length=20, blank=True)
    tipo_proyecto = models.ForeignKey(
        TipoProyecto, on_delete=models.PROTECT, related_name="solicitudes"
    )
    solicitante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    titulo = models.CharField(max_length=200)
    #: Lo respondido en el formulario, con la etiqueta que tenía el campo al
    #: solicitar: [{"etiqueta", "tipo", "valor"}]. Si el formulario cambia
    #: después, la solicitud conserva lo que se pidió.
    respuestas = models.JSONField(default=list, blank=True)
    #: La plantilla llena que cargó quien solicita.
    archivo = models.FileField(upload_to=ruta_archivo, max_length=255)
    archivo_nombre = models.CharField(max_length=255)
    archivo_tipo = models.CharField(max_length=100, blank=True)
    archivo_tamano = models.PositiveIntegerField(default=0)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.PENDIENTE)
    paso_actual = models.ForeignKey(
        PasoProyecto, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    #: Quiénes pueden decidir el paso en curso.
    pendiente_de = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="+")
    cerrada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "solicitud de proyecto"
        verbose_name_plural = "solicitudes de proyecto"

    def __str__(self) -> str:
        return self.numero or self.titulo


class AccionProyecto(ModeloDeEmpresa):
    """Un movimiento del historial de una solicitud de proyecto."""

    class Accion(models.TextChoices):
        CREADA = "creada", "Solicitó"
        ASIGNADA = "asignada", "Pasó a"
        APROBADA = "aprobada", "Aprobó"
        RECHAZADA = "rechazada", "Rechazó"
        ESCALADA = "escalada", "Escaló a"
        CANCELADA = "cancelada", "Canceló"
        TERMINADA = "terminada", "Quedó"

    solicitud = models.ForeignKey(
        SolicitudProyecto, on_delete=models.CASCADE, related_name="acciones"
    )
    paso = models.ForeignKey(
        PasoProyecto, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    accion = models.CharField(max_length=12, choices=Accion.choices)
    comentario = models.TextField(blank=True)
    detalle = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "movimiento de la solicitud de proyecto"
        verbose_name_plural = "movimientos de la solicitud de proyecto"
