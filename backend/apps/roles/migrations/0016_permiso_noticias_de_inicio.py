"""El permiso del carrusel de Inicio (`noticias.gestionar`) para
**Administrador** y **Superusuario**.

Ver el carrusel no pide permiso. Talento Humano lo recibe asignándoselo a su
rol. Como las anteriores: crea los permisos del catálogo que falten, solo suma
y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ROLES = ["Superusuario", "Administrador"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
    permiso = Permission.objects.get(content_type=tipo, codename="noticias.gestionar")
    for rol in Group.objects.filter(name__in=ROLES):
        rol.permissions.add(permiso)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0015_permisos_de_codigos_de_conducta"),
        ("permissions", "0022_permiso_noticias_de_inicio"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
