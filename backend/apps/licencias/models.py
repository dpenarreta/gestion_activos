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
    """Un tipo de permiso que se puede solicitar, con su forma de aprobarse.

    **Clasificación (05/11/2026).** Cada tipo dice qué descuenta, en qué
    unidad se pide y qué ausencia genera en Gestión Humana al aprobarse
    (`apps.ausencias`, ver `ausencias.services.create_from_request`):

    - `descuento`: «sueldo» (ausencia con descuento de sueldo), «vacaciones»
      (sale de las vacaciones pendientes, la lógica de `restricciones.py`) o
      «ninguno» (con goce de sueldo; por defecto).
    - `unidad`: «dias» (por defecto) u «horas» (un solo día, con hora de
      inicio y de fin).
    - `tipo_ausencia`: MEDICO, PERSONAL o VACACIONES, el tipo de `LeaveRecord`
      que genera. Con descuento de vacaciones es siempre VACACIONES.

    `descuenta_vacaciones` es el espejo de `descuento == "vacaciones"`: lo
    siguen leyendo las restricciones, el chat y la pantalla actual. Lo
    mantiene `save()`; `descuento` es el que manda.
    """

    class Adjunto(models.TextChoices):
        NO = "no", "No se pide"
        OPCIONAL = "opcional", "Opcional"
        OBLIGATORIO = "obligatorio", "Obligatorio"

    class Descuento(models.TextChoices):
        SUELDO = "sueldo", "Con descuento de sueldo"
        VACACIONES = "vacaciones", "Se descuenta de las vacaciones"
        NINGUNO = "ninguno", "Con goce de sueldo (sin descuento)"

    class Unidad(models.TextChoices):
        DIAS = "dias", "Por días"
        HORAS = "horas", "Por horas"

    class TipoAusencia(models.TextChoices):
        # Los mismos valores que `ausencias.LeaveRecord.Type`.
        MEDICO = "MEDICO", "Médico"
        PERSONAL = "PERSONAL", "Personal"
        VACACIONES = "VACACIONES", "Vacaciones"

    nombre = models.CharField(max_length=120)
    descripcion = models.TextField(blank=True)
    activo = models.BooleanField(default=True)
    adjunto = models.CharField(max_length=12, choices=Adjunto.choices, default=Adjunto.NO)
    orden = models.PositiveSmallIntegerField(default=0)

    # Restricciones (20/10/2026), que se informan a quien solicita y se
    # validan (ver restricciones.py). 0 = sin restricción.
    dias_minimos = models.PositiveSmallIntegerField(default=0)
    dias_maximos = models.PositiveSmallIntegerField(default=0)
    #: Los días salen de sus vacaciones pendientes y, al aprobarse, quedan
    #: como gozados.
    descuenta_vacaciones = models.BooleanField(default=False)
    #: Sábados y domingos que, como mínimo, salen de cada período anual de
    #: vacaciones; los que falten se marcan por defecto al completarlo.
    sabados_por_periodo = models.PositiveSmallIntegerField(default=0)
    domingos_por_periodo = models.PositiveSmallIntegerField(default=0)
    #: Si se pide un motivo al solicitar (vacaciones no lo pide).
    pide_motivo = models.BooleanField(default=True)
    #: Otras indicaciones para quien solicita, una por línea.
    restricciones = models.TextField(blank=True)
    descuento = models.CharField(
        max_length=10, choices=Descuento.choices, default=Descuento.NINGUNO
    )
    unidad = models.CharField(max_length=5, choices=Unidad.choices, default=Unidad.DIAS)
    tipo_ausencia = models.CharField(
        max_length=15, choices=TipoAusencia.choices, default=TipoAusencia.PERSONAL
    )

    class Meta:
        ordering = ["orden", "nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="flujo_permiso_unico")
        ]
        verbose_name = "flujo de permiso"
        verbose_name_plural = "flujos de permiso"

    def __str__(self) -> str:
        return self.nombre

    def save(self, *args, **kwargs):
        """`descuenta_vacaciones` sigue a `descuento`. Quien todavía escribe
        solo el booleano (código o datos anteriores al 05/11/2026) marca un
        tipo «ninguno» como de vacaciones; uno «sueldo» no cambia."""
        if self.descuento == self.Descuento.VACACIONES:
            self.descuenta_vacaciones = True
        elif self.descuenta_vacaciones:
            if self.descuento == self.Descuento.NINGUNO:
                self.descuento = self.Descuento.VACACIONES
            else:
                self.descuenta_vacaciones = False
        if self.descuento == self.Descuento.VACACIONES:
            self.tipo_ausencia = self.TipoAusencia.VACACIONES
            self.unidad = self.Unidad.DIAS
        if self.tipo_ausencia == self.TipoAusencia.MEDICO:
            # 05/11/2026: un permiso médico pide motivo y documento obligatorio.
            # La API responde 400 si se intenta otra cosa; esto cubre el resto
            # de caminos (código, comandos).
            self.pide_motivo = True
            self.adjunto = self.Adjunto.OBLIGATORIO
        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = set(update_fields) | {
                "descuento",
                "descuenta_vacaciones",
                "tipo_ausencia",
                "unidad",
                "pide_motivo",
                "adjunto",
            }
        return super().save(*args, **kwargs)

    @property
    def por_horas(self) -> bool:
        return self.unidad == self.Unidad.HORAS


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
    """Una solicitud de permiso y en qué paso de su flujo va.

    `unidad`, `descuento` y `tipo_ausencia` se copian de su tipo al crearla
    (auditoría UX/UI, 05/11/2026) y no cambian después: si Talento Humano
    reclasifica el tipo, las solicitudes ya hechas se siguen leyendo como se
    pidieron (sus horas, sus días de vacaciones, sus ausencias)."""

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
    #: Solo en un tipo por horas (`FlujoPermiso.unidad`): obligatorias, en un
    #: solo día (`desde == hasta`) y con el fin después del inicio.
    hora_desde = models.TimeField(null=True, blank=True)
    hora_hasta = models.TimeField(null=True, blank=True)
    unidad = models.CharField(
        max_length=5, choices=FlujoPermiso.Unidad.choices, default=FlujoPermiso.Unidad.DIAS
    )
    descuento = models.CharField(
        max_length=10,
        choices=FlujoPermiso.Descuento.choices,
        default=FlujoPermiso.Descuento.NINGUNO,
    )
    tipo_ausencia = models.CharField(
        max_length=15,
        choices=FlujoPermiso.TipoAusencia.choices,
        default=FlujoPermiso.TipoAusencia.PERSONAL,
    )
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

    def save(self, *args, **kwargs):
        """Al crearla, la clasificación es la de su tipo en ese momento."""
        if self._state.adding and self.flujo_id:
            self.unidad = self.flujo.unidad
            self.descuento = self.flujo.descuento
            self.tipo_ausencia = self.flujo.tipo_ausencia
        return super().save(*args, **kwargs)

    @property
    def dias(self) -> int:
        return (self.hasta - self.desde).days + 1

    @property
    def por_horas(self) -> bool:
        return self.unidad == FlujoPermiso.Unidad.HORAS

    @property
    def descuenta_vacaciones(self) -> bool:
        return self.descuento == FlujoPermiso.Descuento.VACACIONES

    @property
    def minutos(self) -> int | None:
        """Lo que dura un permiso por horas, en minutos (`None` si es por
        días)."""
        if self.hora_desde is None or self.hora_hasta is None:
            return None
        inicio = self.hora_desde.hour * 60 + self.hora_desde.minute
        fin = self.hora_hasta.hour * 60 + self.hora_hasta.minute
        return fin - inicio


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
