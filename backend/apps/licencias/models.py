"""Solicitud de permisos (módulo Institucional, 19/10/2026).

Cada tipo de permiso (vacaciones, permiso médico…) es un **flujo** que se
configura: sus **pasos** de aprobación, en orden, con quién aprueba cada uno
(el jefe inmediato según el organigrama, una persona, las personas de un rol o
quien ocupe un cargo; con varias opciones, aprueba cualquiera), y a quién se
avisa el resultado final según se apruebe o se rechace.

Una **solicitud** recorre los pasos de su flujo: queda pendiente de los
aprobadores del paso en curso, que la aprueban (pasa al siguiente), la
rechazan (termina) o la escalan a otra persona o rol. Cada movimiento queda en
su historial.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.contrib.auth.models import Group
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


class Destino(models.TextChoices):
    """A quién apunta un aprobador o un aviso."""

    SOLICITANTE = "solicitante", "Quien solicita"
    APROBADORES = "aprobadores", "Quienes aprobaron"
    JEFE_INMEDIATO = "jefe_inmediato", "Su jefe inmediato (organigrama)"
    PERSONA = "persona", "Una persona"
    ROL = "rol", "Las personas de un rol"
    CARGO = "cargo", "Quien ocupe un cargo"


#: Los destinos que sirven para aprobar (quien solicita y quienes ya
#: aprobaron solo reciben avisos).
APROBADORES_VALIDOS = {Destino.JEFE_INMEDIATO, Destino.PERSONA, Destino.ROL, Destino.CARGO}


class FlujoPermiso(ModeloDeEmpresa):
    """Un tipo de permiso que se puede solicitar, con su forma de aprobarse."""

    class Adjunto(models.TextChoices):
        NO = "no", "No se pide"
        OPCIONAL = "opcional", "Opcional"
        OBLIGATORIO = "obligatorio", "Obligatorio"

    nombre = models.CharField(max_length=120)
    descripcion = models.TextField(blank=True)
    activo = models.BooleanField(default=True)
    adjunto = models.CharField(max_length=12, choices=Adjunto.choices, default=Adjunto.NO)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["orden", "nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="flujo_permiso_unico")
        ]
        verbose_name = "flujo de permiso"
        verbose_name_plural = "flujos de permiso"

    def __str__(self) -> str:
        return self.nombre


class _ConDestino(ModeloDeEmpresa):
    """Un destino: su tipo y, según el tipo, la persona, el rol o el cargo."""

    tipo = models.CharField(max_length=20, choices=Destino.choices)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    rol = models.ForeignKey(
        Group, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    cargo = models.ForeignKey(
        "organizacion.Cargo", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )

    class Meta:
        abstract = True


class PasoFlujo(ModeloDeEmpresa):
    """Un paso de aprobación, en el orden en que se recorre."""

    flujo = models.ForeignKey(FlujoPermiso, on_delete=models.CASCADE, related_name="pasos")
    orden = models.PositiveSmallIntegerField(default=1)
    nombre = models.CharField(max_length=120)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "paso del flujo"
        verbose_name_plural = "pasos del flujo"

    def __str__(self) -> str:
        return self.nombre


class AprobadorPaso(_ConDestino):
    """Quién puede aprobar un paso. Con varios, aprueba cualquiera."""

    paso = models.ForeignKey(PasoFlujo, on_delete=models.CASCADE, related_name="aprobadores")

    class Meta:
        verbose_name = "aprobador del paso"
        verbose_name_plural = "aprobadores del paso"


class AvisoFlujo(_ConDestino):
    """A quién se avisa el resultado final de una solicitud."""

    class Resultado(models.TextChoices):
        APROBADA = "aprobada", "Si se aprueba"
        RECHAZADA = "rechazada", "Si se rechaza"

    flujo = models.ForeignKey(FlujoPermiso, on_delete=models.CASCADE, related_name="avisos")
    resultado = models.CharField(max_length=10, choices=Resultado.choices)

    class Meta:
        verbose_name = "aviso del flujo"
        verbose_name_plural = "avisos del flujo"


def ruta_adjunto(instance, filename: str) -> str:
    return f"licencias/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class SolicitudPermiso(ModeloDeEmpresa):
    """Una solicitud de permiso y en qué paso de su flujo va."""

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        APROBADA = "aprobada", "Aprobada"
        RECHAZADA = "rechazada", "Rechazada"
        CANCELADA = "cancelada", "Cancelada"

    flujo = models.ForeignKey(FlujoPermiso, on_delete=models.PROTECT, related_name="solicitudes")
    solicitante = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    desde = models.DateField()
    hasta = models.DateField()
    motivo = models.TextField(blank=True)
    adjunto = models.FileField(upload_to=ruta_adjunto, max_length=255, blank=True)
    adjunto_nombre = models.CharField(max_length=255, blank=True)
    adjunto_tipo = models.CharField(max_length=100, blank=True)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.PENDIENTE)
    paso_actual = models.ForeignKey(
        PasoFlujo, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    #: Quiénes pueden resolver el paso en curso.
    pendiente_de = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="+")
    cerrada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "solicitud de permiso"
        verbose_name_plural = "solicitudes de permiso"

    def __str__(self) -> str:
        return f"{self.flujo} de {self.solicitante}"

    @property
    def dias(self) -> int:
        return (self.hasta - self.desde).days + 1


class AccionSolicitud(ModeloDeEmpresa):
    """Un movimiento del historial de una solicitud."""

    class Accion(models.TextChoices):
        CREADA = "creada", "Solicitó"
        ASIGNADA = "asignada", "Pasó a"
        APROBADA = "aprobada", "Aprobó"
        RECHAZADA = "rechazada", "Rechazó"
        ESCALADA = "escalada", "Escaló a"
        CANCELADA = "cancelada", "Canceló"
        TERMINADA = "terminada", "Quedó"

    solicitud = models.ForeignKey(
        SolicitudPermiso, on_delete=models.CASCADE, related_name="acciones"
    )
    paso = models.ForeignKey(
        PasoFlujo, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    accion = models.CharField(max_length=12, choices=Accion.choices)
    comentario = models.TextField(blank=True)
    detalle = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "movimiento de la solicitud"
        verbose_name_plural = "movimientos de la solicitud"
