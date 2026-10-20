"""Onboarding y capacitación (módulo Institucional, 20/10/2026).

Cada **material** de capacitación es de la empresa (lo ven todos), de un área
(una unidad del organigrama) o de un cargo. Combina, según haga falta, un
texto, un archivo (PDF o presentación de PowerPoint) y un enlace a un video:
al menos uno de los tres. Tiene su **evaluación** de opción múltiple con nota
mínima e intentos.

El plan de una persona es lo de la empresa más lo de su área y su cargo. Al
entrar a una empresa se le asigna su **onboarding** con una fecha límite: no
bloquea el sistema, pero ve un aviso con su avance hasta aprobar todo. Talento
Humano ve los puntajes y las oportunidades de mejora (lo que más se falla).
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


def ruta_material(instance, filename: str) -> str:
    return f"capacitacion/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class Material(ModeloDeEmpresa):
    """Un material de capacitación con su evaluación."""

    class Alcance(models.TextChoices):
        EMPRESA = "empresa", "Toda la empresa"
        UNIDAD = "unidad", "Un área (unidad del organigrama)"
        CARGO = "cargo", "Un cargo"

    class Tipo(models.TextChoices):
        PDF = "pdf", "Documento PDF"
        VIDEO = "video", "Video (enlace)"
        TEXTO = "texto", "Texto"

    titulo = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True)
    alcance = models.CharField(max_length=8, choices=Alcance.choices, default=Alcance.EMPRESA)
    unidad = models.ForeignKey(
        "organizacion.UnidadOrganizacional",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="+",
    )
    cargo = models.ForeignKey(
        "organizacion.Cargo", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    tipo = models.CharField(max_length=6, choices=Tipo.choices, default=Tipo.TEXTO)
    archivo = models.FileField(upload_to=ruta_material, max_length=255, blank=True)
    archivo_nombre = models.CharField(max_length=255, blank=True)
    archivo_tipo = models.CharField(max_length=120, blank=True)
    url = models.URLField(max_length=500, blank=True)
    contenido = models.TextField(blank=True)
    nota_minima = models.PositiveSmallIntegerField(default=70)
    intentos_max = models.PositiveSmallIntegerField(default=3)
    orden = models.PositiveSmallIntegerField(default=0)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["alcance", "orden", "titulo"]
        verbose_name = "material de capacitación"
        verbose_name_plural = "materiales de capacitación"

    def __str__(self) -> str:
        return self.titulo


class Pregunta(ModeloDeEmpresa):
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="preguntas")
    texto = models.CharField(max_length=500)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "pregunta"
        verbose_name_plural = "preguntas"


class Opcion(ModeloDeEmpresa):
    pregunta = models.ForeignKey(Pregunta, on_delete=models.CASCADE, related_name="opciones")
    texto = models.CharField(max_length=300)
    correcta = models.BooleanField(default=False)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "opción"
        verbose_name_plural = "opciones"


class Onboarding(ModeloDeEmpresa):
    """El onboarding asignado a una persona en la empresa."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    fecha_limite = models.DateField()
    completado_en = models.DateTimeField(null=True, blank=True)
    asignado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["empresa", "usuario"], name="un_onboarding_por_persona")
        ]
        verbose_name = "onboarding"
        verbose_name_plural = "onboardings"


class VistaMaterial(ModeloDeEmpresa):
    """Que la persona abrió el material: hace falta para evaluarse."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="vistas")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "usuario", "material"], name="una_vista_por_material"
            )
        ]


class Intento(ModeloDeEmpresa):
    """Un intento de la evaluación de un material, con su puntaje y qué
    preguntas falló (para las oportunidades de mejora)."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="intentos")
    puntaje = models.PositiveSmallIntegerField()
    aprobado = models.BooleanField(default=False)
    #: Ids de las preguntas falladas, separados por comas.
    falladas = models.TextField(blank=True)
    #: Si Talento Humano le devolvió los intentos, los anteriores no cuentan.
    anulado = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "intento de evaluación"
        verbose_name_plural = "intentos de evaluación"
