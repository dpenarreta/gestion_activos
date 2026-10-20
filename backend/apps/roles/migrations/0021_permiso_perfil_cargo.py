"""El permiso de escribir el perfil de cada cargo (objetivo, funciones,
competencias y KPIs) para **Administrador** y **Superusuario**. Solo suma y es
idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ROLES = ["Superusuario", "Administrador"]
PERMISOS = ["institucional.perfil_cargo"]


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
        ("roles", "0020_permisos_solicitud_de_permisos"),
        ("permissions", "0027_permiso_perfil_cargo"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
