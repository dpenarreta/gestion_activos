"""Peticiones de compra: lo que alguien necesita y todavía no existe.

El inventario responde qué hay; esto responde qué falta. Son dos preguntas
distintas y hasta ahora solo la primera tenía dónde vivir: una laptop pedida
por correo no está en ninguna parte hasta que llega, así que nadie podía decir
cuántas se pidieron, quién las pidió ni en qué punto estaban. Cuando alguien
preguntaba, la respuesta salía de la memoria de quien compra.

Una solicitud **nace con encargado**: quien pide elige a quién le llega. Es lo
que hace que «Solicitudes recibidas» sea una lista de tareas y no una bandeja
común donde todo el mundo supone que lo está mirando otro.

Lo que se pide puede venir del catálogo —un tipo de dispositivo, un componente—
o escribirse. Exigir el catálogo obligaría a dar de alta un tipo para poder
pedirlo, y lo que se pide muchas veces es justamente lo que aún no existe; no
ofrecerlo devolvería la dispersión de escribir «laptop», «Laptop» y «portátil»
para lo mismo. Por eso van los dos, y el catálogo primero.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa


class Solicitud(ModeloDeEmpresa):
    """Una petición de compra, desde que se pide hasta que se entrega."""

    class Clase(models.TextChoices):
        DISPOSITIVO = "dispositivo", "Dispositivo"
        COMPONENTE = "componente", "Componente o repuesto"

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        EN_GESTION = "en_gestion", "En gestión"
        COMPRADA = "comprada", "Comprada"
        ENTREGADA = "entregada", "Entregada"
        RECHAZADA = "rechazada", "Rechazada"
        CANCELADA = "cancelada", "Cancelada"

    class Prioridad(models.TextChoices):
        BAJA = "baja", "Baja"
        MEDIA = "media", "Media"
        ALTA = "alta", "Alta"

    #: Estados desde los que ya no se mueve nada. Se listan una vez y se
    #: consultan desde el servicio, la vista y la pantalla: tres sitios
    #: decidiendo por su cuenta qué es «cerrada» acabarían discrepando.
    FINALES = frozenset({Estado.ENTREGADA, Estado.RECHAZADA, Estado.CANCELADA})

    #: A dónde puede ir cada estado. Lo que no está aquí no pasa: sin esta
    #: tabla, una solicitud podría volver de «entregada» a «pendiente» y el
    #: historial dejaría de contar lo que de verdad ocurrió.
    TRANSICIONES = {
        Estado.PENDIENTE: {Estado.EN_GESTION, Estado.RECHAZADA, Estado.CANCELADA},
        Estado.EN_GESTION: {Estado.COMPRADA, Estado.RECHAZADA, Estado.CANCELADA},
        # Comprada ya costó dinero: se entrega o se queda registrada como
        # comprada, pero no se rechaza hacia atrás.
        Estado.COMPRADA: {Estado.ENTREGADA},
        Estado.ENTREGADA: set(),
        Estado.RECHAZADA: set(),
        Estado.CANCELADA: set(),
    }

    solicitante = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="solicitudes_hechas",
        help_text="Quien pide. Es lo que llena «Mis solicitudes».",
    )
    encargado = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="solicitudes_recibidas",
        help_text="Quien debe gestionar la compra. Es lo que llena «Solicitudes recibidas».",
    )

    clase = models.CharField(max_length=15, choices=Clase.choices, default=Clase.DISPOSITIVO)
    tipo_dispositivo = models.ForeignKey(
        "activos.TipoDispositivo",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="solicitudes",
    )
    componente = models.ForeignKey(
        "mantenimientos.CatalogoComponente",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="solicitudes",
    )
    #: Lo que se pide cuando no está en el catálogo, o la precisión que el
    #: catálogo no da: «Laptop» es el tipo, «con 32 GB para diseño» es esto.
    detalle = models.CharField(
        max_length=200,
        blank=True,
        help_text="Qué se necesita exactamente, si el catálogo no lo dice todo.",
    )
    #: Con qué características se pide, cuando el tipo las declara: «una laptop»
    #: y «una laptop con 32 GB y disco NVMe» son dos compras distintas, y la
    #: diferencia se perdía en la justificación escrita a mano —donde no se
    #: puede filtrar ni comparar con lo que se acabó comprando—.
    #:
    #: Se guardan bajo el nombre declarado, igual que en la ficha del activo, así
    #: que lo pedido y lo entregado se leen con el mismo vocabulario.
    especificaciones = models.JSONField(default=dict, blank=True)
    cantidad = models.PositiveSmallIntegerField(default=1)
    justificacion = models.TextField(
        help_text="Para qué hace falta. Es lo que sostiene la compra ante quien la autoriza."
    )
    prioridad = models.CharField(max_length=10, choices=Prioridad.choices, default=Prioridad.MEDIA)
    fecha_necesaria = models.DateField(
        null=True,
        blank=True,
        help_text="Para cuándo se necesita. Vacío significa que no hay fecha comprometida.",
    )

    estado = models.CharField(max_length=15, choices=Estado.choices, default=Estado.PENDIENTE)

    objects = gestor_de_lo_que_cuelga("empresa")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "solicitud"
        verbose_name_plural = "solicitudes"

    def __str__(self) -> str:
        return f"#{self.pk} · {self.lo_que_se_pide}"

    @property
    def lo_que_se_pide(self) -> str:
        """Una sola línea para listados, correos y actas.

        El catálogo manda cuando está, porque es el nombre que todos usan; el
        detalle se suma detrás en vez de sustituirlo, que es como se escribe
        «Laptop — con 32 GB para diseño».
        """
        del_catalogo = ""
        if self.tipo_dispositivo_id:
            del_catalogo = self.tipo_dispositivo.nombre
        elif self.componente_id:
            del_catalogo = self.componente.nombre
        if del_catalogo and self.detalle:
            return f"{del_catalogo} — {self.detalle}"
        return del_catalogo or self.detalle

    @property
    def esta_cerrada(self) -> bool:
        return self.estado in self.FINALES

    def puede_pasar_a(self, estado: str) -> bool:
        return estado in self.TRANSICIONES.get(self.estado, set())

    def clean(self):
        """Que la solicitud diga qué se pide, y una sola cosa.

        Sin esto entrarían peticiones vacías —un encargado y una justificación,
        sin objeto— que hay que devolver preguntando qué era, y peticiones con
        un tipo de dispositivo y un componente a la vez, que no se sabe si son
        una compra o dos.
        """
        if self.tipo_dispositivo_id and self.componente_id:
            raise ValidationError(
                "Una solicitud pide un dispositivo o un componente, no las dos cosas. "
                "Para pedir ambos, haga dos solicitudes: cada una se compra y se "
                "entrega por su cuenta."
            )
        if self.clase == self.Clase.DISPOSITIVO and self.componente_id:
            raise ValidationError({"componente": "Esta solicitud es de un dispositivo."})
        if self.clase == self.Clase.COMPONENTE and self.tipo_dispositivo_id:
            raise ValidationError(
                {"tipo_dispositivo": "Esta solicitud es de un componente o repuesto."}
            )
        if not self.tipo_dispositivo_id and not self.componente_id and not self.detalle.strip():
            raise ValidationError(
                {
                    "detalle": (
                        "Elija algo del catálogo o describa qué se necesita: una "
                        "solicitud sin objeto hay que devolverla preguntando qué era."
                    )
                }
            )
        if self.cantidad is not None and self.cantidad < 1:
            raise ValidationError({"cantidad": "La cantidad es de al menos uno."})


class MovimientoSolicitud(BaseModel):
    """Cada paso de una solicitud, con quién lo dio y por qué.

    Append-only, igual que el historial de custodia: es el respaldo de que algo
    se pidió el día que se pidió y se rechazó por un motivo. Un recorrido que
    se puede reescribir no sirve para explicar por qué un área lleva tres meses
    sin su equipo.
    """

    solicitud = models.ForeignKey(Solicitud, on_delete=models.CASCADE, related_name="movimientos")
    estado_anterior = models.CharField(max_length=15, choices=Solicitud.Estado.choices, blank=True)
    estado_nuevo = models.CharField(max_length=15, choices=Solicitud.Estado.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="movimientos_de_solicitud",
    )
    #: Por qué. En un rechazo es lo único que le llega al solicitante como
    #: explicación, así que el servicio lo exige ahí.
    nota = models.TextField(blank=True)

    objects = gestor_de_lo_que_cuelga("solicitud__empresa")

    class Meta:
        ordering = ["created_at"]
        verbose_name = "movimiento de la solicitud"
        verbose_name_plural = "movimientos de la solicitud"

    def __str__(self) -> str:
        return f"#{self.solicitud_id}: {self.estado_anterior or '—'} → {self.estado_nuevo}"
