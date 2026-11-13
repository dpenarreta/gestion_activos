"""Las notificaciones de la campana.

Cada aviso que el sistema le manda a una persona con cuenta —por correo o
solo dentro del sistema— le deja además una notificación: de qué módulo viene,
un resumen y el enlace a lo que la originó. Así no depende del correo para
enterarse, y si el SMTP falla, la campana igual lo tiene.
"""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.empresas.models import ModeloDeEmpresa


class Notificacion(ModeloDeEmpresa):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notificaciones_campana"
    )
    #: El módulo de origen (`apps.notificaciones.modulos.MODULOS`).
    modulo = models.CharField(max_length=30)
    #: Qué la disparó: la clave de la plantilla de correo o del evento.
    tipo = models.CharField(max_length=60)
    titulo = models.CharField(max_length=150)
    resumen = models.CharField(max_length=300, blank=True)
    #: Ruta interna del sistema (empieza con «/»); vacía si no hay a dónde ir.
    enlace = models.CharField(max_length=300, blank=True)
    leida_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["usuario", "leida_en"])]

    def __str__(self):
        return self.titulo


class DispositivoPush(BaseModel):
    """Un teléfono con la app «Intranet LCE» que recibe avisos push.

    No es por empresa: el aviso le llega a la persona sin importar en qué
    empresa esté trabajando; la empresa va en la notificación misma.

    Un token por teléfono (único en la base): si el mismo teléfono se registra
    otra vez —otro usuario u otro inicio de sesión— la fila se mueve a la
    sesión actual en vez de duplicarse, y nadie recibe avisos ajenos.

    Va ligado a la `Session` con CASCADE: revocar o borrar la sesión corta el
    push de ese teléfono, igual que corta el acceso (US-009, 12/11/2026).

    El push es genérico por la LOPDP (12/11/2026): pasa por Expo, Google y
    Apple, así que solo lleva el módulo y los IDs; el contenido se lee dentro
    de la app con sesión. Por lo mismo, `nombre` guarda solo el modelo genérico
    del teléfono, nunca el nombre que le puso su dueño.
    """

    PLATAFORMA_ANDROID = "android"
    PLATAFORMA_IOS = "ios"
    PLATAFORMAS = [(PLATAFORMA_ANDROID, "Android"), (PLATAFORMA_IOS, "iOS")]

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="dispositivos_push"
    )
    session = models.ForeignKey(
        "authentication.Session", on_delete=models.CASCADE, related_name="dispositivos_push"
    )
    #: El Expo push token («ExponentPushToken[…]»); la unicidad la garantiza la BD.
    token = models.CharField(max_length=200, unique=True)
    plataforma = models.CharField(max_length=10, choices=PLATAFORMAS)
    #: Modelo genérico del teléfono (p. ej. «Pixel 7»), opcional.
    nombre = models.CharField(max_length=100, blank=True)
    #: Se apaga con `DeviceNotRegistered` de Expo o al revocar la sesión.
    activo = models.BooleanField(default=True)
    ultimo_envio_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        # El envío busca «los dispositivos activos de este usuario».
        indexes = [models.Index(fields=["usuario", "activo"])]

    def __str__(self):
        # Sin ninguna parte del token: identifica el teléfono y saldría en el
        # admin y en los logs.
        return f"{self.get_plataforma_display()} · {self.nombre or f'#{self.pk}'}"
