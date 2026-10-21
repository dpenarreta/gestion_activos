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
    """P1 a P4 del flujo ITIL de la empresa. Los valores guardados siguen siendo
    los de siempre; la etiqueta dice las dos cosas."""

    CRITICA = "critica", "P1 · Crítica"
    ALTA = "alta", "P2 · Alta"
    MEDIA = "media", "P3 · Media"
    BAJA = "baja", "P4 · Baja"


class TipoTicket(models.TextChoices):
    INCIDENTE = "incidente", "Incidente"
    SOLICITUD = "solicitud", "Solicitud"
    CONSULTA = "consulta", "Consulta"


class Impacto(models.TextChoices):
    """A cuántos afecta: la mitad de la matriz de prioridad."""

    ALTO = "alto", "Alto: toda la empresa, una sucursal o un proceso crítico"
    MEDIO = "medio", "Medio: un área o un grupo"
    BAJO = "bajo", "Bajo: un usuario"


class Urgencia(models.TextChoices):
    """Cuánto apura: la otra mitad de la matriz."""

    ALTA = "alta", "Alta: la operación está detenida"
    MEDIA = "media", "Media: degradada, con alternativa"
    BAJA = "baja", "Baja: puede programarse"


class Canal(models.TextChoices):
    """Por dónde llegó el ticket. Solo el portal es autoservicio; los demás los
    registra el equipo en nombre de quien pide."""

    PORTAL = "portal", "Portal (formulario)"
    TELEFONO = "telefono", "Teléfono"
    WHATSAPP = "whatsapp", "WhatsApp"
    PRESENCIAL = "presencial", "Presencial"
    CORREO = "correo", "Correo"


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
    #: De 1 (menos crítica) al total de categorías (ver `criticidad.py`).
    peso = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["nombre"]
        constraints = [
            models.UniqueConstraint(fields=["empresa", "nombre"], name="categoria_soporte_unica")
        ]

    def __str__(self) -> str:
        return self.nombre


class CasoAyuda(BaseModel):
    """Un servicio del catálogo dentro de una categoría («TRK-01 Falla general
    del tracking»). Elegirlo en el formulario fija el tipo, la prioridad base,
    el nivel por donde entra y, si lo tiene, su plazo propio."""

    categoria = models.ForeignKey(Categoria, on_delete=models.CASCADE, related_name="casos")
    #: El código del catálogo de servicios (TRK-01, ERP-04…). Opcional.
    codigo = models.CharField(max_length=20, blank=True)
    nombre = models.CharField(max_length=120)
    tipo = models.CharField(max_length=10, choices=TipoTicket.choices, default=TipoTicket.INCIDENTE)
    prioridad = models.CharField(max_length=10, choices=Prioridad.choices, default=Prioridad.MEDIA)
    #: De 1 (menos crítico) al total de casos de su categoría (ver `criticidad.py`).
    peso = models.PositiveSmallIntegerField(default=0)
    #: Por dónde entra (un caso de infraestructura puede ir directo a N2).
    #: Vacío: el primer nivel.
    nivel_inicial = models.ForeignKey(
        NivelSoporte, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    #: Plazo propio de solución (o de entrega, en una solicitud), en minutos.
    #: Gana sobre las reglas de SLA. Vacío: las reglas.
    minutos_plazo = models.PositiveIntegerField(
        null=True, blank=True, validators=[MinValueValidator(5)]
    )
    #: Si lo aprueba el jefe del área de quien pide (el responsable del área).
    aprueba_jefe_area = models.BooleanField(default=False)
    #: Áreas cuyo responsable también aprueba (Talento Humano, Financiero…).
    aprueban = models.ManyToManyField(
        "organizacion.Departamento", blank=True, related_name="casos_que_aprueba"
    )
    activo = models.BooleanField(default=True)

    @property
    def requiere_aprobacion(self) -> bool:
        return self.aprueba_jefe_area or self.aprueban.exists()

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
        help_text="Minutos para resolver, desde que se crea el ticket, en el calendario de "
        "su prioridad.",
    )
    #: Minutos para la primera respuesta. Vacío: el de su prioridad por defecto.
    minutos_respuesta = models.PositiveIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)]
    )

    class Meta:
        ordering = ["categoria__nombre", "prioridad"]


class ConfiguracionMesa(ModeloDeEmpresa):
    """Lo general de la mesa de la empresa: sus metas y si los P1 corren 24/7.

    Una fila por empresa; si no existe, rigen los valores por defecto.
    """

    #: Porcentaje de tickets que deben resolverse dentro del SLA.
    meta_sla = models.PositiveSmallIntegerField(
        default=85, validators=[MinValueValidator(1), MaxValueValidator(100)]
    )
    #: Y el de los P1.
    meta_sla_critica = models.PositiveSmallIntegerField(
        default=95, validators=[MinValueValidator(1), MaxValueValidator(100)]
    )
    #: Los P1 se miden en horas calendario (las 24 h). Si no, en horario hábil.
    critica_24x7 = models.BooleanField(default=True)
    #: Los nombres propios de la empresa para estados y prioridades:
    #: ``{"estados": {"atendido": "Resuelto"}, "prioridades": {"critica": "P1"}}``.
    etiquetas = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["empresa"], name="configuracion_mesa_unica")]


class HorarioMesa(ModeloDeEmpresa):
    """Una franja del horario hábil de la mesa: con él se miden los plazos de
    P2 a P4 y se cuentan los días del cierre automático."""

    dia_semana = models.PositiveSmallIntegerField(
        validators=[MaxValueValidator(6)], help_text="0 = lunes … 6 = domingo"
    )
    hora_inicio = models.TimeField(default=time(8, 0))
    hora_fin = models.TimeField(default=time(17, 30))

    class Meta:
        ordering = ["dia_semana", "hora_inicio"]


class FeriadoMesa(ModeloDeEmpresa):
    """Fechas sin atención hábil (feriados, cierres): no cuentan para el plazo."""

    desde = models.DateField()
    hasta = models.DateField()
    motivo = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["desde"]


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
        # La matriz de prioridad: con estas dos respuestas el ticket puede
        # subir sobre la prioridad base de su caso.
        "impacto": ("¿A quién afecta?", Tipo.LISTA),
        "urgencia": ("¿Puede seguir trabajando?", Tipo.LISTA),
    }
    #: Los del sistema que se pueden ocultar o volver opcionales. El resto los
    #: necesitan la cola, la prioridad o los avisos.
    #: Teléfono, agencia y área salen de «Mis datos» desde el 20/10/2026: ya no se
    #: ocultan desde aquí.
    BASE_OCULTABLES = ("impacto", "urgencia")

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
        #: Una solicitud que necesita visto bueno: no entra a la cola hasta
        #: que aprueban todos.
        ESPERANDO_APROBACION = "esperando_aprobacion", "Esperando aprobación"
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

    tipo = models.CharField(max_length=10, choices=TipoTicket.choices, default=TipoTicket.INCIDENTE)
    canal = models.CharField(max_length=12, choices=Canal.choices, default=Canal.PORTAL)
    #: Quien lo pidió, con su cuenta (desde el 20/10/2026 solo piden personas
    #: registradas; vacío en los tickets de antes).
    solicitante = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tickets_de_soporte",
    )
    #: Quién lo registró en nombre del usuario (vacío: lo creó él en el portal).
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    impacto = models.CharField(max_length=6, choices=Impacto.choices, blank=True)
    urgencia = models.CharField(max_length=6, choices=Urgencia.choices, blank=True)
    #: La del caso elegido; `prioridad` puede subir por la matriz o ajustarse.
    prioridad_base = models.CharField(max_length=10, choices=Prioridad.choices, blank=True)
    prioridad = models.CharField(max_length=10, choices=Prioridad.choices)
    #: El nivel jerárquico del cargo de quien pide al crear el ticket: suma en
    #: la criticidad (el de arriba pesa más). Se guarda para que un cambio de
    #: cargo posterior no reordene la cola en silencio.
    nivel_solicitante = models.ForeignKey(
        "organizacion.NivelJerarquico",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    #: La suma de los pesos de lo que se eligió (ver `criticidad.py`): ordena la
    #: cola y nunca se muestra; se ve solo `criticidad`.
    puntaje = models.PositiveSmallIntegerField(default=0, db_index=True)
    criticidad = models.CharField(
        max_length=10,
        blank=True,
        choices=[
            ("muy_baja", "Muy baja"),
            ("baja", "Baja"),
            ("media", "Media"),
            ("alta", "Alta"),
            ("muy_alta", "Muy alta"),
            ("critica", "Crítica"),
        ],
    )
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
    #: La primera respuesta del equipo (pasar a curso, pedir datos o atender).
    respondido_en = models.DateTimeField(null=True, blank=True)
    atendido_en = models.DateTimeField(null=True, blank=True)
    cerrado_en = models.DateTimeField(null=True, blank=True)
    reaperturas = models.PositiveSmallIntegerField(default=0)
    escalamientos = models.PositiveSmallIntegerField(default=0)

    # SLA de respuesta: desde que se crea hasta la primera respuesta.
    sla_respuesta_minutos = models.PositiveIntegerField(default=0)
    sla_respuesta_vence = models.DateTimeField(null=True, blank=True)
    sla_respuesta_vencida_notificada = models.BooleanField(default=False)

    # SLA de solución, de punta a punta: corre desde que se crea, en el
    # calendario de su prioridad, y no se reinicia al escalar. Se detiene al
    # esperar al usuario y al quedar atendido; al volver (o al reabrirse) sigue
    # con lo que quedaba.
    sla_minutos = models.PositiveIntegerField(default=0)
    sla_vence = models.DateTimeField(null=True, blank=True)
    sla_restante_al_pausar = models.PositiveIntegerField(null=True, blank=True)
    #: Cuándo se cumple el 80 % del plazo: ahí se avisa.
    sla_alerta_en = models.DateTimeField(null=True, blank=True)
    sla_alerta_enviada = models.BooleanField(default=False)
    sla_vencido_notificado = models.BooleanField(default=False)
    escalado_por_sla = models.BooleanField(default=False)
    #: Si se atendió dentro del plazo (se fija al atender; vacío mientras no).
    sla_cumplido = models.BooleanField(null=True, blank=True)

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


class EncuestaTicket(BaseModel):
    """La encuesta de satisfacción de un ticket, desde el enlace de seguimiento."""

    ticket = models.OneToOneField(Ticket, on_delete=models.CASCADE, related_name="encuesta")
    calificacion = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    resuelto = models.BooleanField()
    comentario = models.TextField(blank=True)

    objects = gestor_de_lo_que_cuelga("ticket__empresa")


class AprobacionTicket(BaseModel):
    """Un visto bueno que pide una solicitud (jefe de área, Talento Humano…).

    El aprobador entra al sistema para decidir: el correo solo lo lleva ahí.
    Si no se pudo saber quién aprueba (el área no tiene responsable con
    cuenta), decide quien coordina la mesa.
    """

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        APROBADA = "aprobada", "Aprobada"
        RECHAZADA = "rechazada", "Rechazada"

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="aprobaciones")
    #: «Jefe de área (Cobranzas)», «Talento Humano»…
    rol = models.CharField(max_length=120)
    aprobador = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    estado = models.CharField(max_length=10, choices=Estado.choices, default=Estado.PENDIENTE)
    decidido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decidido_en = models.DateTimeField(null=True, blank=True)
    nota = models.CharField(max_length=500, blank=True)

    objects = gestor_de_lo_que_cuelga("ticket__empresa")

    class Meta:
        ordering = ["created_at"]


class PesoArea(ModeloDeEmpresa):
    """Cuánto pesa cada área en la criticidad de sus tickets: de 1 al total de
    áreas (ver `criticidad.py`). Las áreas son las del organigrama."""

    area = models.ForeignKey(
        "organizacion.Departamento", on_delete=models.CASCADE, related_name="+"
    )
    peso = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["peso"]
        constraints = [models.UniqueConstraint(fields=["empresa", "area"], name="peso_area_unico")]
