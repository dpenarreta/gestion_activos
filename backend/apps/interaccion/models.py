"""La interacción con la plataforma, por persona y por día (18/11/2026).

Para el dashboard «Interacción de la plataforma». Antes solo existía el último
uso de cada sesión (`Session.last_used_at`), sin historial; desde aquí queda
un registro diario:

- **Conexión**: cada minuto con alguna petición autenticada (la pantalla
  abierta consulta el servidor cada medio minuto, así que cuenta el tiempo
  con la intranet abierta, en la web o en la app).
- **Actividad**: cada minuto en que la persona hizo algo en la web (un clic,
  una tecla, desplazarse), que la pantalla informa con un latido.
- **Funcionalidades**: la pantalla en la que se hizo (su título), en
  minutos de uso.

Solo se guardan contadores y horas, nunca lo que se escribió ni se vio.
"""

from django.conf import settings
from django.db import models


class ActividadDiaria(models.Model):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="actividad_diaria"
    )
    fecha = models.DateField(db_index=True)
    primera_conexion = models.DateTimeField()
    ultima_senal = models.DateTimeField()
    #: Minutos con alguna petición autenticada.
    minutos_conectado = models.PositiveIntegerField(default=1)
    #: Minutos con un clic, una tecla o desplazamiento en la web.
    minutos_activo = models.PositiveIntegerField(default=0)
    ultimo_latido = models.DateTimeField(null=True, blank=True)
    #: Veces que entró en el día: la primera conexión y cada regreso tras
    #: más de `PAUSA_INGRESO` sin señales.
    ingresos = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["usuario", "fecha"], name="actividad_unica_por_dia")
        ]

    def __str__(self):
        return f"{self.usuario_id} · {self.fecha}"


class UsoFuncionalidad(models.Model):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="uso_funcionalidades"
    )
    fecha = models.DateField(db_index=True)
    #: El título de la pantalla («Organigrama», «Asignar activo»…).
    funcionalidad = models.CharField(max_length=120)
    minutos = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["usuario", "fecha", "funcionalidad"], name="uso_unico_por_dia"
            )
        ]

    def __str__(self):
        return f"{self.funcionalidad} · {self.fecha}"
