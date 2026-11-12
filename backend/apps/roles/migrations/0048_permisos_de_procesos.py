"""Permisos de la Solicitud de procesos (US-008, decisión del usuario, 12/11/2026).

La Solicitud de procesos usa el mismo motor que la de proyectos, con permisos
propios: `procesos.configurar` y `procesos.ver_todas`. Quien configura
proyectos no configura procesos por defecto, pero para que nadie que hoy
atiende las solicitudes quede sin acceso a las nuevas, se concede:

- **`procesos.configurar`** a los roles y cuentas con `proyectos.configurar`.
- **`procesos.ver_todas`** a los roles y cuentas con `proyectos.ver_todas`.
- **Los dos a «Administrador» y «Superusuario»**, si existen (los roles
  iniciales llevan todo el catálogo).

Se pueden quitar después desde Roles. No van en `permisos_por_cargo.REGLAS`
(los de proyectos tampoco están). Solo suma y es idempotente. Revertirla los
quita de todos los roles y cuentas.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

#: Permiso nuevo → el de proyectos del que se toma quién lo recibe.
EQUIVALENTES = {
    "procesos.configurar": "proyectos.configurar",
    "procesos.ver_todas": "proyectos.ver_todas",
}
ROLES = ("Administrador", "Superusuario")


def _permisos(apps, codenames):
    Permission = apps.get_model("auth", "Permission")
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0045` y `0047`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("users", "User")
    for codename, base in EQUIVALENTES.items():
        nuevo = next(iter(_permisos(apps, [codename])), None)
        if nuevo is None:
            continue
        bases = _permisos(apps, [base])
        ids = set(Group.objects.filter(name__in=ROLES).values_list("pk", flat=True))
        if bases:
            ids |= set(Group.objects.filter(permissions__in=bases).values_list("pk", flat=True))
        for rol in Group.objects.filter(pk__in=ids).exclude(permissions=nuevo):
            rol.permissions.add(nuevo)
        if bases:
            for cuenta in (
                User.objects.filter(user_permissions__in=bases)
                .exclude(user_permissions=nuevo)
                .distinct()
            ):
                cuenta.user_permissions.add(nuevo)


def retirar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("users", "User")
    for nuevo in _permisos(apps, list(EQUIVALENTES)):
        for rol in Group.objects.filter(permissions=nuevo):
            rol.permissions.remove(nuevo)
        for cuenta in User.objects.filter(user_permissions=nuevo):
            cuenta.user_permissions.remove(nuevo)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0047_permiso_ver_todo_el_organigrama"),
        ("permissions", "0062_permisos_de_procesos"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
