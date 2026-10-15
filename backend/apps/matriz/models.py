"""Matriz de obligaciones: el módulo que controla las obligaciones
regulatorias, contractuales e internas de cada empresa.

Se construye sobre lo que el sistema ya tiene —usuarios, empresas y su
membresía con roles, catálogo de permisos, auditoría, correo, adjuntos y la
tarea programada— y agrega solo lo propio de la matriz. La especificación
completa está en `matriz_admin/docs/modulo/MODULO-MATRIZ-OBLIGACIONES.md`; los
números de sección de los comentarios remiten a ella.

Fase 1: los catálogos compartidos. Obligaciones, períodos, evidencias y
recordatorios llegan en las fases siguientes.
"""

from django.db import models

from apps.core.models import BaseModel


class _Catalogo(BaseModel):
    """Áreas y entidades de control (§4.3).

    **Compartidos por todas las empresas**, a diferencia de los catálogos del
    inventario: el SRI o el IESS son los mismos para LaarCourier que para
    LaarSeguridad, y un reporte de cumplimiento por entidad tiene que poder
    sumar las de todo el grupo sin emparejar nombres escritos de dos formas.
    Por eso heredan de `BaseModel` y no de `ModeloDeEmpresa`.
    """

    codigo = models.CharField(max_length=10, unique=True)

    class Meta:
        abstract = True
        ordering = ["nombre"]

    def __str__(self) -> str:
        return f"{self.codigo} — {self.nombre}"


class Area(_Catalogo):
    """Área responsable de una obligación: Contabilidad, Talento Humano…

    No es el departamento del inventario. Aquél organiza personas y equipos de
    una empresa; éste clasifica obligaciones, y se comparte entre empresas.
    """

    nombre = models.CharField(max_length=120)

    class Meta(_Catalogo.Meta):
        verbose_name = "área"
        verbose_name_plural = "áreas"


class EntidadControl(_Catalogo):
    """Quien exige la obligación: SRI, IESS, Ministerio del Trabajo…"""

    nombre = models.CharField(max_length=160)

    class Meta(_Catalogo.Meta):
        verbose_name = "entidad de control"
        verbose_name_plural = "entidades de control"
