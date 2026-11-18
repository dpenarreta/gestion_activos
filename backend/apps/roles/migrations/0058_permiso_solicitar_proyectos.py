"""«Solicitar proyectos y seguir las propias solicitudes»
(`proyectos.solicitar`) para los roles de cargo (18/11/2026).

Pedido del usuario: faltaba el permiso; hasta hoy cualquiera con sesión
podía pedir proyectos. Como `procesos.solicitar` (`0050`) y
`chat.calendario_google` (`0057`), se concede a los roles con
`licencias.solicitar` (el permiso de todo empleado de `PERMISOS_BASE`) y a
«Administrador» y «Superusuario», para que nadie que hoy pide proyectos deje
de poder hacerlo. Solo suma y es idempotente; revertirla lo quita de todos
los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

NUEVO = "proyectos.solicitar"
BASES = ("licencias.solicitar",)
ROLES = ("Administrador", "Superusuario")


def _permisos(apps, codenames):
    Permission = apps.get_model("auth", "Permission")
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0040` y `0048`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    nuevo = next(iter(_permisos(apps, [NUEVO])), None)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    bases = _permisos(apps, BASES)
    ids = set(Group.objects.filter(name__in=ROLES).values_list("pk", flat=True))
    if bases:
        ids |= set(Group.objects.filter(permissions__in=bases).values_list("pk", flat=True))
    for rol in Group.objects.filter(pk__in=ids).exclude(permissions=nuevo):
        rol.permissions.add(nuevo)


def retirar(apps, schema_editor):
    nuevo = next(iter(_permisos(apps, [NUEVO])), None)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=nuevo):
        rol.permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0057_permiso_calendario_google"),
        ("permissions", "0072_permiso_solicitar_proyectos"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
