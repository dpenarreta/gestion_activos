"""Acta de entrega de equipos AEE-LC-01 (16/11/2026).

Todo lo nuevo nace con su permiso (regla del usuario): `activos.acta_entrega`
va a «Administrador» y «Superusuario», y a todo rol que ya pueda asignar
equipos (`activos.asignar`), porque el acta es el papel de esa misma entrega.
A los demás roles se da a mano desde Roles.

Solo suma y es idempotente. Revertirla lo quita de todos los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations
from django.db.models import Q

NUEVO = "activos.acta_entrega"
ROLES = ("Administrador", "Superusuario")


def _permiso(apps, codename):
    Permission = apps.get_model("auth", "Permission")
    return Permission.objects.filter(
        content_type__app_label="permissions", codename=codename
    ).first()


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0054`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    nuevo = _permiso(apps, NUEVO)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    asignar = _permiso(apps, "activos.asignar")
    filtro = Q(name__in=ROLES)
    if asignar is not None:
        filtro |= Q(permissions=asignar)
    for rol in Group.objects.filter(filtro).distinct():
        rol.permissions.add(nuevo)


def retirar(apps, schema_editor):
    nuevo = _permiso(apps, NUEVO)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=nuevo).distinct():
        rol.permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0054_permisos_nomina_y_cedula"),
        ("permissions", "0069_permiso_acta_entrega"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
