"""Los permisos del Chat en los roles generales.

- **Administrador** y **Superusuario**: historial completo y grupos por área.

Como las anteriores: crea los permisos del catálogo que falten, solo suma (no
quita nada a nadie) y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

POR_ROL = {
    "Superusuario": None,  # todos los del módulo
    "Administrador": None,
}


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
    del_modulo = Permission.objects.filter(content_type=tipo, codename__startswith="chat.")

    for nombre_rol, codenames in POR_ROL.items():
        rol = Group.objects.filter(name=nombre_rol).first()
        if rol is None:
            continue
        rol.permissions.add(
            *(del_modulo if codenames is None else del_modulo.filter(codename__in=codenames))
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0010_permisos_de_soporte"),
        ("permissions", "0016_permisos_de_chat"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
