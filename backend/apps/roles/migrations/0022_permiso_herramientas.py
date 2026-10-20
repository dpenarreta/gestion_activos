"""El permiso de administrar el catálogo de herramientas y licencias (y ver
quién usa cada una) para **Administrador** y **Superusuario**. Solo suma y es
idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ROLES = ["Superusuario", "Administrador"]
PERMISOS = ["herramientas.gestionar"]


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
        ("roles", "0021_permiso_perfil_cargo"),
        ("permissions", "0028_permiso_herramientas"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
