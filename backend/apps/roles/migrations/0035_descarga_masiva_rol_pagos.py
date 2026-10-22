"""La descarga masiva de roles de pagos por área (22/10/2026).

`roles_pago.descarga_masiva` va a Administrador, Superusuario y a los roles de
los cargos de `DESCARGA_MASIVA` (`apps.organizacion.permisos_por_cargo`): el
Coordinador Nacional de Gestión Humana, el Asistente de Gestión Humana que le
reporta y el Asistente de Nómina. Se quita de los demás roles de cargo; es
idempotente.
"""

from django.db import migrations

from apps.organizacion.permisos_por_cargo import DESCARGA_MASIVA, normalizar
from apps.permissions.catalog import as_django_permission_tuples

PERMISO = "roles_pago.descarga_masiva"
ADMINS = ["Superusuario", "Administrador"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    Cargo = apps.get_model("organizacion", "Cargo")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    nombre = dict(as_django_permission_tuples())[PERMISO]
    permiso, _ = Permission.objects.get_or_create(
        content_type=tipo, codename=PERMISO, defaults={"name": nombre}
    )
    for rol in Group.objects.filter(name__in=ADMINS):
        rol.permissions.add(permiso)
    elegidos = {normalizar(c) for c in DESCARGA_MASIVA}
    for cargo in Cargo.objects.exclude(rol=None).select_related("rol"):
        if elegidos & {normalizar(cargo.nombre), normalizar(cargo.rol.name)}:
            cargo.rol.permissions.add(permiso)
        else:
            cargo.rol.permissions.remove(permiso)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0034_permisos_nuevos_a_admins"),
        ("permissions", "0039_descarga_masiva_rol_pagos"),
        ("organizacion", "0028_roles_por_cargo"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
