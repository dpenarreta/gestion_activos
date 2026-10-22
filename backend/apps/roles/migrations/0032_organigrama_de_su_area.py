"""Cada persona ve el organigrama de su área (21/10/2026).

`institucional.ver_area` va a todos los roles de cargo (lo de todo empleado) y
a Administrador y Superusuario. Solo suma y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PERMISO = "institucional.ver_area"


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    Cargo = apps.get_model("organizacion", "Cargo")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
    permiso = Permission.objects.get(content_type=tipo, codename=PERMISO)
    de_cargo = list(Cargo.objects.exclude(rol=None).values_list("rol_id", flat=True))
    for rol in Group.objects.filter(pk__in=de_cargo) | Group.objects.filter(
        name__in=["Administrador", "Superusuario"]
    ):
        rol.permissions.add(permiso)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0031_superusuario_y_sin_plantillas"),
        ("organizacion", "0028_roles_por_cargo"),
        ("permissions", "0037_organigrama_de_su_area"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
