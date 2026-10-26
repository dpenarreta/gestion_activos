"""El registro de descargas (26/10/2026): `auditoria.descargas` para
Administrador y Superusuario. Solo suma y es idempotente."""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PERMISO = "auditoria.descargas"
ADMINS = ["Superusuario", "Administrador"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    nombre = dict(as_django_permission_tuples())[PERMISO]
    permiso, _ = Permission.objects.get_or_create(
        content_type=tipo, codename=PERMISO, defaults={"name": nombre}
    )
    for rol in Group.objects.filter(name__in=ADMINS):
        rol.permissions.add(permiso)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0038_seguimiento_rol_pagos"),
        ("permissions", "0043_permiso_descargas"),
    ]

    operations = [migrations.RunPython(sembrar, migrations.RunPython.noop)]
