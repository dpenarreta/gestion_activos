"""Corregir los datos confirmados de Mi perfil (17/11/2026).

Todo lo nuevo nace con su permiso (regla del usuario): `usuarios.corregir_perfil`
va a «Administrador», «Superusuario» y a los roles de Talento Humano (los que
llevan «Talento Humano» en el nombre). A los demás se da a mano desde Roles.

Solo suma y es idempotente. Revertirla lo quita de todos los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations
from django.db.models import Q

NUEVO = "usuarios.corregir_perfil"
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
    filtro = Q(name__in=ROLES) | Q(name__icontains="talento humano")
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
        ("roles", "0055_permiso_acta_entrega"),
        ("permissions", "0070_permiso_corregir_perfil"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
