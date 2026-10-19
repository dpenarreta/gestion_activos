"""Los dos permisos nuevos de la Mesa de ayuda, para quien ya hacía ese trabajo.

- `soporte.registrar` (alta interna de tickets): hasta ahora la hacía quien
  atendía o coordinaba la mesa, así que lo recibe todo rol —y toda cuenta con
  permisos propios— que tenga `soporte.atender` o `soporte.asignar`.
- `soporte.formulario` (el formulario de «Soporte TI»): hasta ahora lo editaba
  quien configuraba la mesa, así que lo recibe quien tenga `soporte.configurar`.

**Superusuario** y **Administrador** los reciben siempre. Como las anteriores:
crea los permisos del catálogo que falten, solo suma (no quita nada a nadie) y
es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

#: Permiso nuevo → los permisos de quien ya hacía ese trabajo.
HEREDADOS = {
    "soporte.registrar": ["soporte.atender", "soporte.asignar"],
    "soporte.formulario": ["soporte.configurar"],
}
SIEMPRE = ["Superusuario", "Administrador"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    User = apps.get_model("users", "User")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )

    for nuevo, de_antes in HEREDADOS.items():
        permiso = Permission.objects.get(content_type=tipo, codename=nuevo)
        previos = Permission.objects.filter(content_type=tipo, codename__in=de_antes)
        roles = set(Group.objects.filter(permissions__in=previos)) | set(
            Group.objects.filter(name__in=SIEMPRE)
        )
        for rol in roles:
            rol.permissions.add(permiso)
        for cuenta in User.objects.filter(user_permissions__in=previos).distinct():
            cuenta.user_permissions.add(permiso)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0011_permisos_de_chat"),
        ("permissions", "0017_permisos_de_soporte_nuevos"),
        ("users", "0002_ultima_conexion_desde_los_intentos"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
