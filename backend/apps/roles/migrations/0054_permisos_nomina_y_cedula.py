"""Perfiles desde nómina (US-021, 16/11/2026).

Todo lo nuevo nace con sus permisos (regla del usuario, CA-4):
`usuarios.sincronizar_nomina` y `usuarios.ver_cedula` van a «Administrador» y
a «Superusuario», si existen (llevan todo el catálogo en
`crear_roles_iniciales`; el prefijo `usuarios.` no está excluido del
Administrador). A los demás roles se dan a mano desde Roles.

Solo suma y es idempotente. Revertirla los quita de todos los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

NUEVOS = ("usuarios.sincronizar_nomina", "usuarios.ver_cedula")
ROLES = ("Administrador", "Superusuario")


def _permisos(apps, codenames):
    Permission = apps.get_model("auth", "Permission")
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0049` y `0051`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    nuevos = _permisos(apps, NUEVOS)
    if not nuevos:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(name__in=ROLES):
        # `add` no duplica: la tabla intermedia ya tiene la pareja si existía.
        rol.permissions.add(*nuevos)


def retirar(apps, schema_editor):
    nuevos = _permisos(apps, NUEVOS)
    if not nuevos:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions__in=nuevos).distinct():
        rol.permissions.remove(*nuevos)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0053_permiso_reemplazo_en_la_ficha"),
        ("permissions", "0068_permisos_nomina_y_cedula"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
