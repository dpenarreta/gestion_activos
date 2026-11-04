"""El rol «Administrador de Gestión Humana» (04/11/2026).

Quien administra el módulo que vino de Nexo sin ser administrador del
sistema: tiene todo `novedades.*` (incluidos administrar, permisos e
Ingresos y salidas) y ningún permiso de otro módulo. Se asigna como
cualquier rol, en la membresía de la empresa.

Solo suma y es idempotente; al revertir se borra solo si nadie lo tiene.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ROL = "Administrador de Gestión Humana"


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        if codename.startswith("novedades."):
            Permission.objects.get_or_create(
                content_type=tipo, codename=codename, defaults={"name": nombre}
            )
    rol, _ = Group.objects.get_or_create(name=ROL)
    rol.permissions.add(
        *Permission.objects.filter(content_type=tipo, codename__startswith="novedades.")
    )


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    rol = Group.objects.filter(name=ROL).first()
    if rol and not rol.user_set.exists() and not rol.membresias.exists():
        rol.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("novedades", "0002_roles_operativos"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
