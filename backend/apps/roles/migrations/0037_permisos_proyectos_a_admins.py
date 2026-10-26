"""Administrador y Superusuario reciben los permisos de la Solicitud de
proyectos (26/10/2026): configurar los tipos de proyecto y ver todas las
solicitudes. Solicitar y decidir lo que a uno le toca no piden permiso. Solo
suma y es idempotente."""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PERMISOS = ["proyectos.configurar", "proyectos.ver_todas"]
ROLES = ["Superusuario", "Administrador"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    nombres = dict(as_django_permission_tuples())
    permisos = [
        Permission.objects.get_or_create(
            content_type=tipo, codename=codigo, defaults={"name": nombres[codigo]}
        )[0]
        for codigo in PERMISOS
    ]
    for rol in Group.objects.filter(name__in=ROLES):
        rol.permissions.add(*permisos)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0036_textos_legales_a_admins"),
        ("permissions", "0041_permisos_proyectos"),
    ]

    operations = [migrations.RunPython(sembrar, migrations.RunPython.noop)]
