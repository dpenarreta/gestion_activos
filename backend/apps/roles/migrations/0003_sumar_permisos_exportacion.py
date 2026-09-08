"""Suma al rol "Superusuario" los permisos de exportación a Excel.

Mismo criterio que `0002`: se añaden los que falten sin quitar ninguno, para no
deshacer un recorte deliberado del rol. Es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

NOMBRE_ROL = "Superusuario"


def sincronizar_permisos(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    content_type, _ = ContentType.objects.get_or_create(
        app_label="permissions", model="modulepermission"
    )
    for codename, name in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=content_type, codename=codename, defaults={"name": name}
        )

    rol = Group.objects.filter(name=NOMBRE_ROL).first()
    if rol is None:
        return

    faltantes = Permission.objects.filter(content_type=content_type).exclude(
        id__in=rol.permissions.values_list("id", flat=True)
    )
    if faltantes.exists():
        rol.permissions.add(*faltantes)


def noop_reverse(apps, schema_editor):
    # No se revocan permisos al revertir: no hay forma de distinguir los que
    # agregó esta migración de los que un administrador otorgó después.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0002_sincronizar_rol_superusuario"),
    ]

    operations = [
        migrations.RunPython(sincronizar_permisos, noop_reverse),
    ]
