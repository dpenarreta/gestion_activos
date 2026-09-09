"""Catálogos organizacionales: a qué área pertenece un activo y quién lo
custodia (RF-01).

`Empleado` es un catálogo propio y no `settings.AUTH_USER_MODEL`: la mayoría
de las personas que reciben un equipo nunca inician sesión en el sistema, y
obligar a crearles una cuenta solo para asignarles una laptop llenaría la
tabla de usuarios de cuentas inertes —cada una con su superficie de
autenticación— sin ningún beneficio. El vínculo con una cuenta real existe,
pero es opcional (`usuario`).
"""

import re

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel

PREFIJO_EMPLEADO = "EMP"
_PATRON_CODIGO = re.compile(rf"^{PREFIJO_EMPLEADO}-(\d+)$")


def generar_codigo_empleado() -> str:
    """Siguiente código correlativo (EMP-0001, EMP-0002…).

    Se calcula leyendo el máximo existente, lo que no es atómico: dos altas
    simultáneas pueden proponer el mismo número. La restricción única de la
    base es la que lo garantiza de verdad; aquí solo se propone un valor
    razonable, y quien lo necesite puede escribir el suyo.
    """
    ultimo = (
        Empleado.objects.filter(codigo_empleado__startswith=f"{PREFIJO_EMPLEADO}-")
        .order_by("-codigo_empleado")
        .values_list("codigo_empleado", flat=True)
        .first()
    )
    siguiente = 1
    if ultimo:
        coincidencia = _PATRON_CODIGO.match(ultimo)
        if coincidencia:
            siguiente = int(coincidencia.group(1)) + 1
    return f"{PREFIJO_EMPLEADO}-{siguiente:04d}"


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


class Ubicacion(BaseModel):
    """Lugar físico donde está el equipo (§4.1 del documento funcional).

    Es un catálogo y no el texto libre que había antes porque «Bodega TI»,
    «bodega de TI» y «Bodega  TI» son el mismo sitio para una persona y tres
    para una consulta: con texto libre, filtrar el inventario por ubicación
    —que es lo que pide el §14— devuelve un tercio de los equipos que están
    ahí, y nadie nota lo que falta.

    Se separa del departamento a propósito: el área dice de quién es el
    presupuesto del equipo, la ubicación dice dónde ir a buscarlo. Un equipo
    de Contabilidad puede estar en la bodega de TI esperando reasignación.
    """

    sede = models.CharField(
        max_length=120,
        help_text="Edificio, local o ciudad. Ej.: «Matriz Quito».",
    )
    nombre = models.CharField(
        max_length=120,
        help_text="Lugar dentro de la sede. Ej.: «Bodega TI», «Oficina 302».",
    )
    detalle = models.CharField(
        max_length=150,
        blank=True,
        help_text="Precisión opcional: piso, ala, número de rack.",
    )
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["sede", "nombre"]
        verbose_name = "ubicación"
        verbose_name_plural = "ubicaciones"
        # Dos ubicaciones con el mismo nombre en la misma sede serían
        # indistinguibles en el desplegable del formulario.
        constraints = [
            models.UniqueConstraint(fields=["sede", "nombre"], name="ubicacion_unica_por_sede")
        ]

    def __str__(self) -> str:
        return self.nombre_completo

    @property
    def nombre_completo(self) -> str:
        return f"{self.sede} · {self.nombre}" if self.sede else self.nombre


class Empleado(BaseModel):
    """Persona que puede tener activos bajo su custodia.

    No se elimina físicamente (`activo = False` en su lugar): un empleado que
    sale de la empresa sigue siendo el custodio histórico que aparece en los
    movimientos de sus equipos, y borrarlo dejaría ese historial sin nombre.

    Se identifica con un **código interno** y no con la cédula. El sistema solo
    necesita un identificador único y estable para saber quién custodia qué; la
    cédula es un dato personal de identificación que no aporta nada a esa
    finalidad y sí obligaría a protegerlo en la bitácora de auditoría —que es
    append-only— y en la plantilla de carga masiva, que se descarga y circula
    como archivo. Ver `docs/data-protection-review.md`.
    """

    nombres = models.CharField(max_length=120)
    apellidos = models.CharField(max_length=120)
    codigo_empleado = models.CharField(
        max_length=30,
        unique=True,
        help_text="Identificador interno del empleado (ej. EMP-0001). Se genera solo si se deja vacío.",
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

    def save(self, *args, **kwargs):
        if not self.codigo_empleado:
            self.codigo_empleado = generar_codigo_empleado()
        return super().save(*args, **kwargs)

    @property
    def nombre_completo(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()
