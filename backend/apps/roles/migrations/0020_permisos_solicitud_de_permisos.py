"""Los permisos de la Solicitud de permisos para **Administrador** y
**Superusuario**: configurar los flujos y ver todas las solicitudes.

Solicitar y aprobar lo que a uno le toca no piden permiso. Talento Humano los
recibe asignándoselos a su rol. Solo suma y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ROLES = ["Superusuario", "Administrador"]
PERMISOS = ["licencias.configurar", "licencias.ver_todas"]


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
        ("roles", "0019_permiso_vacaciones"),
        ("permissions", "0026_permisos_solicitud_de_permisos"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
