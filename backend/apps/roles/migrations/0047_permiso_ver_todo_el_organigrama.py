"""«Ver todo el organigrama» (decisión del usuario, 12/11/2026).

Por defecto cada persona ve solo el organigrama de su área (TI ve TI, Cartera
ve Cartera). Todas las áreas las ven el superusuario y quien tenga
`institucional.ver_todo`. Armar el organigrama, asignar cargos o escribir
perfiles de cargo ya no lo dan.

Para que nadie que hoy lo usa para su trabajo pierda la vista completa, se
concede:

- **A los roles y cuentas con `institucional.ver`**, que antes significaba
  «ver toda la empresa» (hoy Administrador, Analista Clima y Cultura y
  Superusuario).
- **A los roles de Gestión Humana que mantienen el organigrama**: Analista
  Clima y Cultura, Coordinador Nacional de GGHH y Jefe Nacional de Talento
  Humano y SSO.
- **A «Administrador» y «Superusuario»**, si existen.

Los roles de TI que arman la estructura (Jefe TI, Coordinador TI y
Coordinador de Soporte Técnico) quedan con la vista de su área, como pidió el
usuario. El permiso se marca a mano en Roles para dárselo a otros. No va en
`permisos_por_cargo.REGLAS`, porque la sincronización por cargo lo quitaría de
los roles a los que se les marque a mano.

Solo suma y es idempotente. Revertirla lo quita de todos los roles y cuentas.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

NUEVO = "institucional.ver_todo"
BASES = ("institucional.ver",)
ROLES = (
    "Administrador",
    "Superusuario",
    "Analista Clima y Cultura",
    "Coordinador Nacional de GGHH",
    "Jefe Nacional de Talento Humano y SSO",
)


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
    ids = set()
    if bases:
        ids |= set(Group.objects.filter(permissions__in=bases).values_list("pk", flat=True))
    ids |= set(Group.objects.filter(name__in=ROLES).values_list("pk", flat=True))
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
        ("roles", "0046_permiso_cambiar_area"),
        ("permissions", "0061_permiso_ver_todo_el_organigrama"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
