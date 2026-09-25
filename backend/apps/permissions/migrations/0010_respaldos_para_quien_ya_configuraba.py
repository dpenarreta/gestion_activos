"""Da el permiso nuevo a quien ya hacía esa tarea.

`configuracion.respaldos` se separa de `configuracion.editar`, pero quien
podía cambiar la política de respaldo ayer tiene que poder cambiarla hoy: un
permiso nuevo que nadie tiene deja la pantalla en solo lectura sin que nadie
haya decidido eso, y se descubre el día que alguien va a cambiar la hora del
respaldo y no puede.

Se concede a los roles y a las cuentas que tengan `configuracion.editar`, que
es exactamente quien lo ejercía hasta ahora. A partir de aquí se pueden
separar: quitar uno no quita el otro.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

ANTERIOR = "configuracion.editar"
NUEVO = "configuracion.respaldos"


def _permisos(apps):
    """El `auth.Permission` de cada codename, creándolos si aún no existen.

    Los permisos del catálogo los materializa `create_permissions` en la
    señal `post_migrate`, que corre **después** de todas las migraciones: sin
    esta llamada, el de respaldos todavía no existiría aquí y no habría nada
    que conceder.
    """
    configuracion = apps.get_app_config("permissions")
    configuracion.models_module = True
    create_permissions(configuracion, apps=apps, verbosity=0)
    configuracion.models_module = None

    Permission = apps.get_model("auth", "Permission")
    return (
        Permission.objects.filter(codename=ANTERIOR).first(),
        Permission.objects.filter(codename=NUEVO).first(),
    )


def conceder(apps, schema_editor):
    anterior, nuevo = _permisos(apps)
    if anterior is None or nuevo is None:
        return

    Group = apps.get_model("auth", "Group")
    User = apps.get_model("users", "User")

    for grupo in Group.objects.filter(permissions=anterior):
        grupo.permissions.add(nuevo)

    for cuenta in User.objects.filter(user_permissions=anterior):
        cuenta.user_permissions.add(nuevo)


def retirar(apps, schema_editor):
    anterior, nuevo = _permisos(apps)
    if nuevo is None:
        return

    Group = apps.get_model("auth", "Group")
    User = apps.get_model("users", "User")

    for grupo in Group.objects.filter(permissions=nuevo):
        grupo.permissions.remove(nuevo)

    for cuenta in User.objects.filter(user_permissions=nuevo):
        cuenta.user_permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("permissions", "0009_permiso_de_respaldos"),
        ("users", "0002_ultima_conexion_desde_los_intentos"),
    ]

    operations = [
        migrations.RunPython(conceder, retirar),
    ]
