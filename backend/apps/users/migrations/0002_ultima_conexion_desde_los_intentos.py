"""Rellena `last_login` con lo que ya consta en el registro de intentos.

El campo existe desde Django, pero el inicio de sesión de este sistema emite
tokens en vez de abrir una sesión de Django, así que nunca se escribía: la
columna «última conexión» habría nacido vacía para todo el mundo, incluidas
las cuentas que llevan meses entrando a diario. Y una columna que dice
«Nunca» donde no es verdad no se lee como un dato que falta, se lee como que
la cuenta está sin usar —que es justo la pregunta que esa columna existe para
responder—.

El dato ya estaba: cada inicio de sesión correcto deja su `LoginAttempt`. Esto
solo lo copia al sitio donde la interfaz lo va a buscar.
"""

from django.db import migrations
from django.db.models import Max, OuterRef, Subquery


def traer_del_registro_de_intentos(apps, schema_editor):
    User = apps.get_model("users", "User")
    LoginAttempt = apps.get_model("authentication", "LoginAttempt")

    ultimo_acierto = (
        LoginAttempt.objects.filter(user_id=OuterRef("pk"), successful=True)
        .values("user_id")
        .annotate(ultimo=Max("created_at"))
        .values("ultimo")
    )
    User.objects.filter(last_login__isnull=True).update(last_login=Subquery(ultimo_acierto))


def olvidarlo(apps, schema_editor):
    """Sin vuelta atrás: se deja como está.

    Vaciar `last_login` borraría también lo que hayan anotado los inicios de
    sesión posteriores a esta migración, que es información real.
    """


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0001_initial"),
        ("authentication", "0002_initial"),  # la relación con el usuario se añade ahí
    ]

    operations = [
        migrations.RunPython(traer_del_registro_de_intentos, olvidarlo),
    ]
