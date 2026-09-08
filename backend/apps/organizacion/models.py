"""Catálogos organizacionales: a qué área pertenece un activo y quién lo
custodia (RF-01).

`Empleado` es un catálogo propio y no `settings.AUTH_USER_MODEL`: la mayoría
de las personas que reciben un equipo nunca inician sesión en el sistema, y
obligar a crearles una cuenta solo para asignarles una laptop llenaría la
tabla de usuarios de cuentas inertes —cada una con su superficie de
autenticación— sin ningún beneficio. El vínculo con una cuenta real existe,
pero es opcional (`usuario`).
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Departamento(BaseModel):
    """Área organizacional a la que se adscriben activos y empleados."""

    nombre = models.CharField(max_length=120, unique=True)
    codigo = models.CharField(
        max_length=20,
        unique=True,
        help_text="Identificador corto del área, usado en las etiquetas impresas.",
    )
    descripcion = models.TextField(blank=True)
    responsable = models.ForeignKey(
        "organizacion.Empleado",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="departamentos_a_cargo",
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name = "departamento"
        verbose_name_plural = "departamentos"

    def __str__(self) -> str:
        return self.nombre


class Empleado(BaseModel):
    """Persona que puede tener activos bajo su custodia.

    No se elimina físicamente (`activo = False` en su lugar): un empleado que
    sale de la empresa sigue siendo el custodio histórico que aparece en los
    movimientos de sus equipos, y borrarlo dejaría ese historial sin nombre.
    """

    nombres = models.CharField(max_length=120)
    apellidos = models.CharField(max_length=120)
    documento_identidad = models.CharField(
        max_length=30,
        unique=True,
        help_text="Cédula, pasaporte o identificador interno. Único por empleado.",
    )
    correo = models.EmailField(blank=True)
    telefono = models.CharField(max_length=30, blank=True)
    cargo = models.CharField(max_length=120, blank=True)
    departamento = models.ForeignKey(
        Departamento,
        on_delete=models.PROTECT,
        related_name="empleados",
    )
    # Opcional a propósito: ver el docstring del módulo.
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="empleado",
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["apellidos", "nombres"]
        verbose_name = "empleado"
        verbose_name_plural = "empleados"
        indexes = [models.Index(fields=["apellidos", "nombres"])]

    def __str__(self) -> str:
        return self.nombre_completo

    @property
    def nombre_completo(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()
