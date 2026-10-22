"""El chat de la empresa: canal general, mensajes directos y grupos.

Lo usa toda persona con cuenta en la empresa, en nómina o no, sin ningún
permiso. Decidido con el negocio el 19/10/2026:

- **Conversaciones**: el canal general (todas las personas), los mensajes
  directos uno a uno y los grupos, por área (sus miembros son las personas del
  área) o personalizados (los elige quien los crea).
- **Historial**: se guarda 12 meses. Cada persona ve los últimos 6 de sus
  conversaciones; con `chat.historial_completo`, hasta 12. Nadie lee
  conversaciones ajenas.
- **Archivos**: fotos y documentos hasta 10 MB; lo que pesa más se sugiere
  enviarlo por correo.
- **Sin tiempo real con sockets**: la pantalla consulta lo nuevo cada pocos
  segundos (como máximo 5 de demora).
"""

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.managers import gestor_de_lo_que_cuelga
from apps.empresas.models import ModeloDeEmpresa


class Conversacion(ModeloDeEmpresa):
    class Tipo(models.TextChoices):
        GENERAL = "general", "Canal general"
        DIRECTA = "directa", "Mensaje directo"
        GRUPO = "grupo", "Grupo"
        AREA = "area", "Grupo del área"

    tipo = models.CharField(max_length=10, choices=Tipo.choices)
    #: El de los grupos; el general y los directos se nombran solos.
    nombre = models.CharField(max_length=120, blank=True)
    #: Única por empresa: «general», «d:3-8» (los dos ids, de menor a mayor) o
    #: «g:…» para los grupos. Evita dos canales generales o dos chats directos
    #: entre las mismas personas.
    clave = models.CharField(max_length=80)
    #: El área de un grupo por área: sus miembros son las personas del área.
    departamento = models.ForeignKey(
        "organizacion.Departamento",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="conversaciones",
    )
    creada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    #: Ordena la lista de conversaciones.
    ultimo_mensaje_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["empresa", "clave"], name="conversacion_clave_unica")
        ]

    def __str__(self):
        return self.nombre or self.get_tipo_display()

    @staticmethod
    def clave_de_grupo() -> str:
        return f"g:{uuid.uuid4().hex}"


class Participante(BaseModel):
    conversacion = models.ForeignKey(
        Conversacion, on_delete=models.CASCADE, related_name="participantes"
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="participaciones_chat"
    )
    #: Hasta qué mensaje leyó (su id). Lo que viene después es «sin leer».
    ultimo_leido_id = models.BigIntegerField(default=0)
    #: Cuándo leyó hasta ahí: la confirmación de lectura («Visto 10:32»).
    leido_en = models.DateTimeField(null=True, blank=True)
    #: En un grupo personalizado: puede renombrarlo y cambiar sus miembros.
    administra = models.BooleanField(default=False)

    objects = gestor_de_lo_que_cuelga("conversacion__empresa")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["conversacion", "usuario"], name="participante_chat_unico"
            )
        ]


def ruta_archivo_chat(instance, filename: str) -> str:
    return f"chat/{instance.conversacion_id}/{uuid.uuid4().hex}{PurePath(filename).suffix.lower()}"


class Mensaje(BaseModel):
    conversacion = models.ForeignKey(
        Conversacion, on_delete=models.CASCADE, related_name="mensajes"
    )
    autor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    texto = models.TextField(blank=True)
    archivo = models.FileField(upload_to=ruta_archivo_chat, null=True, blank=True)
    nombre_archivo = models.CharField(max_length=255, blank=True)
    tamano = models.PositiveIntegerField(default=0)
    es_imagen = models.BooleanField(default=False)

    objects = gestor_de_lo_que_cuelga("conversacion__empresa")

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["conversacion", "id"])]


class EstadoChat(BaseModel):
    """Cómo está una persona en el chat (22/10/2026; ver `estados.py`). Es de
    la persona, no de una empresa: se ve igual en todas."""

    class Estado(models.TextChoices):
        DISPONIBLE = "disponible", "Disponible"
        ALMUERZO = "almuerzo", "En almuerzo"
        VACACIONES = "vacaciones", "De vacaciones"
        REUNION = "reunion", "En reunión"
        NO_DISPONIBLE = "no_disponible", "No disponible"

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="estado_chat"
    )
    estado = models.CharField(max_length=14, choices=Estado.choices, default=Estado.DISPONIBLE)
    mensaje = models.CharField(max_length=140, blank=True)
    #: Hasta cuándo dura (almuerzo, reunión, no disponible); vacío, hasta que
    #: lo cambie.
    hasta = models.DateTimeField(null=True, blank=True)
    #: Las vacaciones van aparte: se programan y mandan mientras duran.
    vacaciones_desde = models.DateField(null=True, blank=True)
    vacaciones_hasta = models.DateField(null=True, blank=True)
    mensaje_vacaciones = models.CharField(max_length=140, blank=True)
    #: Su horario de almuerzo: a qué hora sale y cuánto dura.
    almuerzo_inicio = models.TimeField(null=True, blank=True)
    almuerzo_minutos = models.PositiveSmallIntegerField(default=60)

    class Meta:
        verbose_name = "estado en el chat"
        verbose_name_plural = "estados en el chat"
