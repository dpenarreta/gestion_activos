"""«Cambiar el área de una persona» (US-005, 11/11/2026).

Desde US-005 la persona elige su área una sola vez en «Mi perfil»; después
la cambia quien tenga `organizacion.cambiar_area`, en la misma pantalla donde
se reasigna el cargo (Estructura → Asignación de cargos).

Se concede:

- **A los roles que hoy asignan cargos** (`institucional.asignar`): son los
  de Gestión Humana y TI que arman la estructura (los cargos de
  `permisos_por_cargo._ESTRUCTURA`, cuya tabla también lo lleva desde hoy
  para que no se pierda al renombrar el cargo) y cualquier rol al que se le
  haya marcado a mano. También a las cuentas que lo tengan marcado
  directamente, sin rol.
- **Al rol «Administrador»** (TI), aunque no tuviera `institucional.asignar`.
  Superusuario lo trae del «todo el catálogo» de `crear_roles_iniciales`, y
  también aquí si existe.

Solo suma y es idempotente. Revertirla lo quita de todos los roles y cuentas (como
`0045`): si después se concedió a mano, también se quita.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

NUEVO = "organizacion.cambiar_area"
BASES = ("institucional.asignar",)
ADMINS = ("Administrador", "Superusuario")


def _permisos(apps, codenames):
    Permission = apps.get_model("auth", "Permission")
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0045`)."""
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
    con_base = Group.objects.filter(permissions__in=bases) if bases else Group.objects.none()
    ids = set(con_base.values_list("pk", flat=True))
    ids |= set(Group.objects.filter(name__in=ADMINS).values_list("pk", flat=True))
    for rol in Group.objects.filter(pk__in=ids).exclude(permissions=nuevo):
        rol.permissions.add(nuevo)
    if bases:
        User = apps.get_model("users", "User")
        for cuenta in (
            User.objects.filter(user_permissions__in=bases)
            .exclude(user_permissions=nuevo)
            .distinct()
        ):
            cuenta.user_permissions.add(nuevo)


def retirar(apps, schema_editor):
    nuevo = next(iter(_permisos(apps, [NUEVO])), None)
    if nuevo is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=nuevo):
        rol.permissions.remove(nuevo)
    User = apps.get_model("users", "User")
    for cuenta in User.objects.filter(user_permissions=nuevo):
        cuenta.user_permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0045_permiso_textos_de_privacidad"),
        ("permissions", "0060_permiso_cambiar_area"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
