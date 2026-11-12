"""Llamados de atención de Gestión Humana (US-013, 12/11/2026).

- **Causa** (`CausaLlamado`): la falta que se sanciona («Incumplimiento de la
  firma o aceptación del rol de pagos»), con su plazo de reincidencia en meses.
- **Nivel** (`NivelLlamado`): los escalones de una causa, en orden (verbal,
  escrito, sanción económica). Cada uno dice si envía correo, con qué asunto y
  cuerpo (con variables), si copia al jefe inmediato y, en las sanciones, el
  monto sugerido.
- **Llamado** (`LlamadoAtencion`): el registro de una falta de una persona.
  Lo emite Gestión Humana (nace `emitido`) o lo solicita un jefe del
  organigrama para alguien de su equipo (nace `solicitado`, y Gestión Humana lo
  confirma —pasa a `emitido`— o lo rechaza). Un emitido por error se anula y
  deja de contar para la reincidencia.
- **Historial** (`AccionLlamado`): cada movimiento, con quién y cuándo.

Lo que se usó no se borra: una causa o un nivel con llamados se desactiva. El
llamado guarda además el nombre de la causa y del nivel con que se emitió, y
el asunto y el cuerpo del correo tal como salieron, para que el detalle no
cambie si después se editan los textos.
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.empresas.models import ModeloDeEmpresa


def ruta_adjunto(instance, filename: str) -> str:
    """El nombre en disco es aleatorio: el original va en `adjunto_nombre`."""
    return f"llamados/evidencias/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class TipoNivel(models.TextChoices):
    VERBAL = "verbal", "Verbal"
    ESCRITO = "escrito", "Escrito"
    SANCION_ECONOMICA = "sancion_economica", "Sanción económica"


class CausaLlamado(ModeloDeEmpresa):
    """Una causa de llamado de atención y su plazo de reincidencia."""

    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True)
    #: Cuántos meses hacia atrás cuentan los llamados emitidos de la misma
    #: causa para proponer el nivel siguiente.
    meses_reincidencia = models.PositiveSmallIntegerField(
        default=12, validators=[MinValueValidator(1), MaxValueValidator(120)]
    )
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="causa_llamado_unica")
        ]
        verbose_name = "causa de llamado de atención"
        verbose_name_plural = "causas de llamado de atención"

    def __str__(self) -> str:
        return self.nombre


class NivelLlamado(ModeloDeEmpresa):
    """Un nivel de una causa, en el orden en que se escala."""

    causa = models.ForeignKey(CausaLlamado, on_delete=models.CASCADE, related_name="niveles")
    orden = models.PositiveSmallIntegerField(default=1)
    nombre = models.CharField(max_length=120)
    tipo = models.CharField(max_length=20, choices=TipoNivel.choices, default=TipoNivel.ESCRITO)
    envia_correo = models.BooleanField(default=True)
    asunto = models.CharField(max_length=255, blank=True)
    cuerpo = models.TextField(blank=True)
    #: Solo en las sanciones económicas: el monto con que parte el formulario.
    monto_sugerido = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    #: Si el correo va también, en copia, al jefe inmediato de la persona.
    copia_jefe = models.BooleanField(default=False)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["orden", "id"]
        verbose_name = "nivel de llamado de atención"
        verbose_name_plural = "niveles de llamado de atención"

    def __str__(self) -> str:
        return self.nombre


class LlamadoAtencion(ModeloDeEmpresa):
    """Un llamado de atención a una persona."""

    class Estado(models.TextChoices):
        SOLICITADO = "solicitado", "Solicitado"
        EMITIDO = "emitido", "Emitido"
        RECHAZADO = "rechazado", "Rechazado"
        ANULADO = "anulado", "Anulado"

    class EstadoCorreo(models.TextChoices):
        #: El nivel no envía correo (o el llamado aún no se emite).
        NO_APLICA = "no_aplica", "No aplica"
        #: Emitido: el correo sale en cuanto se confirma la transacción.
        PENDIENTE = "pendiente", "Por enviar"
        ENVIADO = "enviado", "Enviado"
        #: La persona no tiene correo registrado.
        SIN_DIRECCION = "sin_direccion", "Sin correo registrado"
        FALLIDO = "fallido", "No se pudo enviar"

    numero = models.CharField(max_length=20, blank=True)
    persona = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="llamados_de_atencion"
    )
    causa = models.ForeignKey(CausaLlamado, on_delete=models.PROTECT, related_name="llamados")
    #: El que propuso el sistema (al solicitar o emitir; al confirmar se recalcula).
    nivel_propuesto = models.ForeignKey(
        NivelLlamado, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    #: El que se aplica.
    nivel = models.ForeignKey(NivelLlamado, on_delete=models.PROTECT, related_name="llamados")
    #: Obligatoria si `nivel` no es el propuesto.
    justificacion_nivel = models.TextField(blank=True)
    #: Los nombres con que se registró (si después se renombran, el llamado no cambia).
    causa_nombre = models.CharField(max_length=150)
    nivel_nombre = models.CharField(max_length=120)
    nivel_tipo = models.CharField(max_length=20, choices=TipoNivel.choices)
    fecha_hecho = models.DateField()
    descripcion = models.TextField()
    monto = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.SOLICITADO)

    adjunto = models.FileField(upload_to=ruta_adjunto, max_length=255, blank=True)
    adjunto_nombre = models.CharField(max_length=255, blank=True)
    adjunto_tipo = models.CharField(max_length=100, blank=True)
    adjunto_tamano = models.PositiveIntegerField(default=0)

    solicitado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    solicitado_en = models.DateTimeField(null=True, blank=True)
    emitido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    emitido_en = models.DateTimeField(null=True, blank=True)
    rechazado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    rechazado_en = models.DateTimeField(null=True, blank=True)
    motivo_rechazo = models.TextField(blank=True)
    anulado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    anulado_en = models.DateTimeField(null=True, blank=True)
    motivo_anulacion = models.TextField(blank=True)
    #: Cuándo se avisó a la persona (campana o correo). Al anular solo se le
    #: avisa si antes se le había notificado.
    notificado_en = models.DateTimeField(null=True, blank=True)

    #: El correo tal como salió (o se intentó enviar).
    correo_estado = models.CharField(
        max_length=15, choices=EstadoCorreo.choices, default=EstadoCorreo.NO_APLICA
    )
    correo_para = models.CharField(max_length=254, blank=True)
    correo_copia = models.CharField(max_length=1000, blank=True)
    correo_asunto = models.CharField(max_length=255, blank=True)
    correo_cuerpo = models.TextField(blank=True)
    correo_enviado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            # La propuesta de nivel: los emitidos de una persona por una causa.
            models.Index(
                fields=["empresa", "persona", "causa", "estado"], name="llamado_reincidencia"
            ),
            models.Index(fields=["empresa", "estado"], name="llamado_estado"),
        ]
        verbose_name = "llamado de atención"
        verbose_name_plural = "llamados de atención"

    def __str__(self) -> str:
        return self.numero or f"Llamado {self.pk}"


class AccionLlamado(ModeloDeEmpresa):
    """Un movimiento del historial de un llamado de atención."""

    class Accion(models.TextChoices):
        SOLICITADO = "solicitado", "Solicitó"
        EMITIDO = "emitido", "Emitió"
        CONFIRMADO = "confirmado", "Confirmó"
        RECHAZADO = "rechazado", "Rechazó"
        ANULADO = "anulado", "Anuló"
        NIVEL_CAMBIADO = "nivel_cambiado", "Cambió el nivel propuesto"
        CORREO = "correo", "Correo"
        #: Gestión Humana pidió reenviar un correo que no salió (ronda 2, QA).
        REENVIO_CORREO = "reenvio_correo", "Reenvió el correo"

    llamado = models.ForeignKey(LlamadoAtencion, on_delete=models.CASCADE, related_name="acciones")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    accion = models.CharField(max_length=15, choices=Accion.choices)
    comentario = models.TextField(blank=True)
    detalle = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "movimiento del llamado de atención"
        verbose_name_plural = "movimientos del llamado de atención"
