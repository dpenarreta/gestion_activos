"""El permiso de ver el encender y apagar módulos (`configuracion.modulos`)
para **Administrador** y **Superusuario**. Solo suma
y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ROLES = ["Superusuario", "Administrador"]
PERMISOS = ["configuracion.modulos"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
    permisos = Permission.objects.filter(content_type=tipo, codename__in=PERMISOS)
    for rol in Group.objects.filter(name__in=ROLES):
        rol.permissions.add(*permisos)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0027_permiso_historial_rol"),
        ("permissions", "0034_permiso_modulos"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
