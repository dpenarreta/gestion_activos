"""Suma al rol "Superusuario" los permisos incorporados al catálogo después
de su siembra inicial (activos, organización, mantenimientos y políticas).

Añade los que falten sin quitar ninguno: si un administrador recortó
deliberadamente el rol, esta migración no debe deshacer esa decisión. Es
idempotente, así que volver a aplicarla no cambia nada.

Cada vez que el catálogo de permisos crezca con un módulo nuevo hará falta
una migración equivalente — no hay sincronización automática a propósito:
otorgar permisos en silencio al arrancar el servidor sería un cambio de
autorización sin traza.
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
    # Los permisos del catálogo se materializan aquí por la misma razón que en
    # roles/0001: `post_migrate` corre al final de todo el `migrate`, así que
    # sobre una base recién creada todavía no existen en este punto.
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
        ("roles", "0001_initial"),
        ("permissions", "0002_alter_modulepermission_options"),
    ]

    operations = [
        migrations.RunPython(sincronizar_permisos, noop_reverse),
    ]
