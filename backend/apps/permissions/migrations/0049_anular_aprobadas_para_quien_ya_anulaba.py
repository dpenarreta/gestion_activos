"""Da `licencias.anular_aprobadas` a quien ya podía anular (05/11/2026).

Anular una solicitud de permiso aprobada (quita sus ausencias y devuelve las
vacaciones) se separa de `licencias.ver_todas`. Para que nadie pierda la
facultad de golpe, se concede a los roles y a las cuentas que hoy tienen
`licencias.ver_todas`, y al rol «Superusuario» (todo el catálogo). A partir de
aquí se pueden separar: quitar uno no quita el otro.

Sigue la forma de `0010_respaldos_para_quien_ya_configuraba`.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

ANTERIOR = "licencias.ver_todas"
NUEVO = "licencias.anular_aprobadas"
SUPERUSUARIO = "Superusuario"


def _permisos(apps):
    """El `auth.Permission` de cada codename, creándolos si aún no existen
    (los del catálogo los crea `post_migrate`, que corre después)."""
    configuracion = apps.get_app_config("permissions")
    configuracion.models_module = True
    create_permissions(configuracion, apps=apps, verbosity=0)
    configuracion.models_module = None

    Permission = apps.get_model("auth", "Permission")
    tipo = {"content_type__app_label": "permissions"}
    return (
        Permission.objects.filter(codename=ANTERIOR, **tipo).first(),
        Permission.objects.filter(codename=NUEVO, **tipo).first(),
    )


def conceder(apps, schema_editor):
    anterior, nuevo = _permisos(apps)
    if nuevo is None:
        return

    Group = apps.get_model("auth", "Group")
    User = apps.get_model("users", "User")

    if anterior is not None:
        for grupo in Group.objects.filter(permissions=anterior):
            grupo.permissions.add(nuevo)
        for cuenta in User.objects.filter(user_permissions=anterior):
            cuenta.user_permissions.add(nuevo)

    # El Superusuario solo si ya existe: crearlo aquí lo dejaría con un solo
    # permiso y `crear_roles_iniciales` lo conservaría así.
    for rol in Group.objects.filter(name=SUPERUSUARIO):
        rol.permissions.add(nuevo)


def retirar(apps, schema_editor):
    _, nuevo = _permisos(apps)
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
        ("permissions", "0048_permiso_anular_aprobadas"),
        ("users", "0002_ultima_conexion_desde_los_intentos"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
