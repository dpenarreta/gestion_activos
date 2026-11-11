"""«Configurar su horario en la Mesa de ayuda» para quien atiende (10/11/2026).

Hasta hoy «Mi horario» colgaba de `soporte.atender`. El usuario lo separa en
`soporte.mi_horario`: deja al técnico ver y cambiar solo sus franjas y
ausencias, y se puede dar o quitar a un rol sin tocar lo demás.

Para que ningún técnico lo pierda el día del cambio, se concede **a los roles
que tienen `soporte.atender`**; no a todos, porque solo le sirve a quien es del
equipo de la mesa. Administrador y Superusuario lo traen del «todo el
catálogo» de `crear_roles_iniciales`.

Solo suma y es idempotente. Revertirla lo quita de los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

NUEVO = "soporte.mi_horario"
BASE = "soporte.atender"


def _permiso(apps, codename):
    Permission = apps.get_model("auth", "Permission")
    return Permission.objects.filter(
        content_type__app_label="permissions", codename=codename
    ).first()


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0043`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    nuevo, base = _permiso(apps, NUEVO), _permiso(apps, BASE)
    if nuevo is None or base is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=base).exclude(permissions=nuevo):
        rol.permissions.add(nuevo)


def retirar(apps, schema_editor):
    nuevo = _permiso(apps, NUEVO)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=nuevo):
        rol.permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0043_permisos_mesa_de_ayuda"),
        ("permissions", "0058_permiso_mi_horario"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
