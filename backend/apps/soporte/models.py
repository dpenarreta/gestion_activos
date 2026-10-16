"""Mesa de ayuda: tickets de soporte de TI que piden los empleados.

Cada empresa tiene su propio equipo y su propia cola. Quien pide no inicia
sesión: llena un formulario público de su empresa y sigue su ticket con un
enlace secreto que le llega por correo. El equipo trabaja desde el sistema.

Cómo se reparte el trabajo (decidido con el negocio, 16/10/2026):

- Todo ticket entra a **una sola cola** por empresa, por orden de llegada. La
  posición que ve quien pidió cuenta los pendientes que llegaron antes.
- Se asigna **por disponibilidad**: cuando un técnico en su horario queda libre,
  recibe el siguiente ticket de una categoría que tiene habilitada y de su
  nivel. Lo que llega fuera de horario espera en la cola.
- El **SLA** corre solo dentro del horario de atención de quien tiene el ticket,
  desde que lo toma hasta que lo marca como atendido; esperar al usuario lo
  pausa. Al 80 % se avisa y al vencer se escala a la línea de supervisión.
"""

import secrets
from datetime import time
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa


class Prioridad(models.TextChoices):
    CRITICA = "critica", "Crítica"
    ALTA = "alta", "Alta"
    MEDIA = "media", "Media"
    BAJA = "baja", "Baja"


# --- Configuración (por empresa) -------------------------------------------------------


class NivelSoporte(ModeloDeEmpresa):
    """Un nivel de escalamiento (N1 Mesa de ayuda, N2 Especialistas…).

    Sus supervisores son la «línea de supervisión»: a ellos se escala un ticket
    cuando se le vence el SLA a alguien de este nivel.
    """

    nombre = models.CharField(max_length=80)
    orden = models.PositiveSmallIntegerField(
        help_text="1 es el primer nivel; escalar lleva al siguiente número."
    )
    supervisores = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="niveles_que_supervisa"
    )

    class Meta:
        ordering = ["orden"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "orden"], name="nivel_soporte_orden_unico")
        ]

    def __str__(self) -> str:
        return f"N{self.orden} · {self.nombre}"


class Categoria(ModeloDeEmpresa):
    """Tipo de ticket (Hardware, Accesos, Red…). Dice qué técnicos lo pueden
    atender (`Tecnico.categorias`)."""

    nombre = models.CharField(max_length=80)
    descripcion = models.CharField(max_length=200, blank=True)
    activa = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="categoria_soporte_unica")
        ]

    def __str__(self) -> str:
        return self.nombre


class CasoAyuda(BaseModel):
    """El caso concreto dentro de una categoría («No enciende el equipo»).
    Elegirlo en el formulario fija la prioridad del ticket."""

    categoria = models.ForeignKey(Categoria, on_delete=models.CASCADE, related_name="casos")
    nombre = models.CharField(max_length=120)
    prioridad = models.CharField(max_length=10, choices=Prioridad.choices, default=Prioridad.MEDIA)
    activo = models.BooleanField(default=True)

    objects = gestor_de_lo_que_cuelga("categoria__empresa")

    class Meta:
        ordering = ["categoria__nombre", "nombre"]

    def __str__(self) -> str:
        return self.nombre


class Tecnico(ModeloDeEmpresa):
    """Una persona del equipo de soporte de la empresa."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="perfiles_de_soporte"
    )
    nivel = models.ForeignKey(NivelSoporte, on_delete=models.PROTECT, related_name="tecnicos")
    categorias = models.ManyToManyField(Categoria, blank=True, related_name="tecnicos")
    #: Cuántos tickets atiende a la vez antes de dejar de recibir. Con 1, recibe
    #: el siguiente en cuanto marca el actual como atendido.
    capacidad = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(20)]
    )
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["usuario__first_name", "usuario__last_name"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "usuario"], name="tecnico_unico_por_empresa")
        ]

    def __str__(self) -> str:
        return self.usuario.get_full_name() or self.usuario.username


class HorarioTecnico(BaseModel):
    """Una franja de atención semanal (lunes 08:00–13:00). Puede haber varias
    por día (mañana y tarde)."""

    tecnico = models.ForeignKey(Tecnico, on_delete=models.CASCADE, related_name="horarios")
    dia_semana = models.PositiveSmallIntegerField(
        validators=[MaxValueValidator(6)], help_text="0 = lunes … 6 = domingo"
    )
    hora_inicio = models.TimeField(default=time(8, 0))
    hora_fin = models.TimeField(default=time(17, 0))

    objects = gestor_de_lo_que_cuelga("tecnico__empresa")

    class Meta:
        ordering = ["dia_semana", "hora_inicio"]


class AusenciaTecnico(BaseModel):
    """Fechas en que el técnico no atiende (vacaciones, permisos, feriados)."""

    tecnico = models.ForeignKey(Tecnico, on_delete=models.CASCADE, related_name="ausencias")
    desde = models.DateField()
    hasta = models.DateField()
    motivo = models.CharField(max_length=120, blank=True)

    objects = gestor_de_lo_que_cuelga("tecnico__empresa")

    class Meta:
        ordering = ["desde"]


class ReglaSLA(ModeloDeEmpresa):
    """Cuánto tiempo hábil hay para atender un ticket.

    Gana la regla más específica que coincida (categoría, área y prioridad;
    vacío significa «cualquiera»). La que tiene las tres vacías es la regla por
    defecto de la empresa.
    """

    categoria = models.ForeignKey(Categoria, on_delete=models.CASCADE, null=True, blank=True)
    area = models.ForeignKey(
        "organizacion.Departamento", on_delete=models.CASCADE, null=True, blank=True
    )
    prioridad = models.CharField(max_length=10, choices=Prioridad.choices, blank=True)
    minutos = models.PositiveIntegerField(
        validators=[MinValueValidator(5)],
        help_text="Minutos hábiles desde que se toma el ticket hasta marcarlo atendido.",
    )

    class Meta:
        ordering = ["categoria__nombre", "prioridad"]


class RespuestaPredefinida(ModeloDeEmpresa):
    """Respuesta que se inserta con `/atajo` al responder un ticket."""

    atajo = models.SlugField(max_length=40)
    titulo = models.CharField(max_length=120)
    texto = models.TextField()

    class Meta:
        ordering = ["atajo"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "atajo"], name="respuesta_atajo_unico")
        ]


class CampoFormulario(ModeloDeEmpresa):
    """Un campo del formulario público de la empresa.

    Los campos *del sistema* (``base``) existen siempre y corresponden a datos
    que el ticket guarda en sus propias columnas. A todos se les puede cambiar
    el texto y el orden; algunos además se pueden ocultar o volver opcionales
    (``BASE_OCULTABLES``). Los demás los agrega la empresa: lo que se responde
    en ellos se copia al ticket (``Ticket.datos_adicionales``) con su etiqueta,
    así que borrar un campo no le quita datos a los tickets viejos.
    """

    class Tipo(models.TextChoices):
        TEXTO = "texto", "Texto corto"
        PARRAFO = "parrafo", "Párrafo"
        NUMERO = "numero", "Número"
        FECHA = "fecha", "Fecha"
        LISTA = "lista", "Lista de opciones"
        CASILLA = "casilla", "Casilla (sí / no)"
        CORREO = "correo", "Correo"
        TELEFONO = "telefono", "Teléfono"

    #: Los campos del sistema, en su orden inicial: clave → (etiqueta, tipo).
    BASE = {
        "nombre": ("Nombre y apellido", Tipo.TEXTO),
        "telefono": ("Teléfono de contacto", Tipo.TELEFONO),
        "correo": ("Correo", Tipo.CORREO),
        "sede": ("Agencia", Tipo.LISTA),
        "area": ("Área", Tipo.LISTA),
        "categoria": ("Categoría", Tipo.LISTA),
        "caso": ("Caso de ayuda", Tipo.LISTA),
        "descripcion": ("Describa el problema", Tipo.PARRAFO),
    }
    #: Los del sistema que se pueden ocultar o volver opcionales. El resto los
    #: necesitan la cola, la prioridad o los avisos.
    BASE_OCULTABLES = ("telefono", "sede", "area")

    clave = models.SlugField(max_length=40)
    etiqueta = models.CharField(max_length=120)
    ayuda = models.CharField(max_length=200, blank=True)
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.TEXTO)
    #: Para las listas propias: las opciones, en orden.
    opciones = models.JSONField(default=list, blank=True)
    obligatorio = models.BooleanField(default=False)
    #: Si se muestra en el formulario.
    activo = models.BooleanField(default=True)
    orden = models.PositiveSmallIntegerField(default=0)
    base = models.BooleanField(default=False)
    #: Si tiene alguna, el campo aparece solo al elegir una de ellas.
    categorias = models.ManyToManyField(Categoria, blank=True, related_name="campos")

    class Meta:
        ordering = ["orden", "id"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "clave"], name="campo_formulario_unico")
        ]

    def __str__(self):
        return self.etiqueta

    @property
    def bloqueado(self) -> bool:
        """Del sistema y sin poder ocultarse ni volverse opcional."""
        return self.base and self.clave not in self.BASE_OCULTABLES


# --- Tickets ---------------------------------------------------------------------------


def _token() -> str:
    return secrets.token_urlsafe(32)


class Ticket(ModeloDeEmpresa):
    class Estado(models.TextChoices):
        NUEVO = "nuevo", "En cola"
        ASIGNADO = "asignado", "Asignado"
        EN_CURSO = "en_curso", "En curso"
        ESPERANDO_USUARIO = "esperando_usuario", "Esperando al usuario"
        ATENDIDO = "atendido", "Atendido"
        CERRADO = "cerrado", "Cerrado"

    #: Los que ocupan al técnico (cuentan para su capacidad).
    ABIERTOS_DEL_TECNICO = (Estado.ASIGNADO, Estado.EN_CURSO)

    anio = models.PositiveSmallIntegerField(editable=False)
    secuencia = models.PositiveIntegerField(editable=False)
    #: El enlace secreto de seguimiento. No se puede adivinar: 32 bytes al azar.
    token = models.CharField(max_length=64, unique=True, default=_token, editable=False)

    # Lo que llena quien pide.
    solicitante_nombre = models.CharField(max_length=150)
    solicitante_telefono = models.CharField(max_length=20, blank=True)
    solicitante_correo = models.EmailField()
    # Teléfono, agencia y área se pueden quitar del formulario: quedan vacíos.
    sede = models.ForeignKey(
        "organizacion.Sede",
        on_delete=models.PROTECT,
        related_name="tickets",
        null=True,
        blank=True,
    )
    area = models.ForeignKey(
        "organizacion.Departamento",
        on_delete=models.PROTECT,
        related_name="tickets",
        null=True,
        blank=True,
    )
    categoria = models.ForeignKey(Categoria, on_delete=models.PROTECT, related_name="tickets")
    caso = models.ForeignKey(CasoAyuda, on_delete=models.PROTECT, related_name="tickets")
    descripcion = models.TextField()
    #: Lo respondido en los campos propios de la empresa, tal como se preguntó:
    #: ``[{"clave", "etiqueta", "valor"}]``.
    datos_adicionales = models.JSONField(default=list, blank=True)

    prioridad = models.CharField(max_length=10, choices=Prioridad.choices)
    estado = models.CharField(max_length=20, choices=Estado.choices, default=Estado.NUEVO)
    nivel = models.ForeignKey(NivelSoporte, on_delete=models.PROTECT, related_name="tickets")
    tecnico = models.ForeignKey(
        Tecnico, on_delete=models.PROTECT, null=True, blank=True, related_name="tickets"
    )

    #: Desde cuándo está en la cola (se renueva al escalar): ordena la cola.
    en_cola_desde = models.DateTimeField()
    #: Entró cuando nadie habilitado estaba en horario.
    fuera_de_horario = models.BooleanField(default=False)
    tomado_en = models.DateTimeField(null=True, blank=True)
    atendido_en = models.DateTimeField(null=True, blank=True)
    cerrado_en = models.DateTimeField(null=True, blank=True)

    # SLA: plazo en minutos hábiles y su vencimiento, calculado al tomarlo con
    # el horario del técnico. Esperar al usuario lo pausa: al volver se
    # recalcula con lo que quedaba.
    sla_minutos = models.PositiveIntegerField(default=0)
    sla_vence = models.DateTimeField(null=True, blank=True)
    sla_restante_al_pausar = models.PositiveIntegerField(null=True, blank=True)
    #: Cuándo se cumple el 80 % del plazo: ahí se avisa.
    sla_alerta_en = models.DateTimeField(null=True, blank=True)
    sla_alerta_enviada = models.BooleanField(default=False)
    sla_vencido_notificado = models.BooleanField(default=False)
    escalado_por_sla = models.BooleanField(default=False)

    ip_origen = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-anio", "-secuencia"]
        constraints = [
            models.UniqueConstraint(
                fields=["empresa", "anio", "secuencia"], name="ticket_numero_unico"
            )
        ]
        indexes = [models.Index(fields=["empresa", "estado", "en_cola_desde"])]

    def __str__(self) -> str:
        return self.numero

    @property
    def numero(self) -> str:
        return f"TCK-{self.anio}-{self.secuencia:06d}"


class MensajeTicket(BaseModel):
    """Una respuesta en el hilo. Las internas solo las ve el equipo."""

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="mensajes")
    #: Vacío cuando escribe quien pidió (desde la página de seguimiento).
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    del_solicitante = models.BooleanField(default=False)
    interno = models.BooleanField(default=False)
    texto = models.TextField()

    objects = gestor_de_lo_que_cuelga("ticket__empresa")

    class Meta:
        ordering = ["created_at"]


def ruta_adjunto_ticket(instance, filename: str) -> str:
    import uuid
    from pathlib import PurePath

    return f"soporte/{instance.ticket_id}/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class AdjuntoTicket(BaseModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="adjuntos")
    mensaje = models.ForeignKey(
        MensajeTicket, on_delete=models.CASCADE, null=True, blank=True, related_name="adjuntos"
    )
    archivo = models.FileField(upload_to=ruta_adjunto_ticket)
    nombre_original = models.CharField(max_length=255)
    tamano = models.PositiveIntegerField(default=0)
    del_solicitante = models.BooleanField(default=False)
    interno = models.BooleanField(default=False)

    objects = gestor_de_lo_que_cuelga("ticket__empresa")

    class Meta:
        ordering = ["created_at"]


class MovimientoTicket(BaseModel):
    """El historial del ticket: cada paso, con quién lo dio. Solo se agregan
    filas."""

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="movimientos")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    descripcion = models.CharField(max_length=255)
    estado_anterior = models.CharField(max_length=20, choices=Ticket.Estado.choices, blank=True)
    estado_nuevo = models.CharField(max_length=20, choices=Ticket.Estado.choices, blank=True)
    nota = models.TextField(blank=True)

    objects = gestor_de_lo_que_cuelga("ticket__empresa")

    class Meta:
        ordering = ["created_at"]


class HorasFueraDeHorario(BaseModel):
    """Tiempo que un técnico dedicó a un ticket fuera de su horario. Lo aprueba
    (o rechaza) un supervisor."""

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        APROBADO = "aprobado", "Aprobado"
        RECHAZADO = "rechazado", "Rechazado"

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="horas_fuera")
    tecnico = models.ForeignKey(Tecnico, on_delete=models.CASCADE, related_name="horas_fuera")
    fecha = models.DateField()
    horas = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.25")), MaxValueValidator(24)],
    )
    descripcion = models.CharField(max_length=255)
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.PENDIENTE)
    revisado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    revisado_en = models.DateTimeField(null=True, blank=True)
    nota_revision = models.CharField(max_length=255, blank=True)

    objects = gestor_de_lo_que_cuelga("ticket__empresa")

    class Meta:
        ordering = ["-fecha", "-created_at"]
