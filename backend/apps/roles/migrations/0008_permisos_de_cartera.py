"""Los permisos de los dashboards de cartera en los roles generales.

- **Administrador** y **Superusuario**: todo el módulo.
- **Consulta / Auditoría**: ver los dashboards (`dashboard.view`), que es lo
  que corresponde a un rol de solo lectura.

Como las anteriores: crea los permisos del catálogo que falten, solo suma (no
quita nada a nadie) y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

POR_ROL = {
    "Superusuario": None,  # todos los del módulo
    "Administrador": None,
    "Consulta / Auditoría": ["dashboard.view"],
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
    del_modulo = Permission.objects.filter(content_type=tipo, codename__startswith="dashboard.")

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
        ("roles", "0007_roles_generales"),
        ("permissions", "0012_permisos_de_cartera"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
