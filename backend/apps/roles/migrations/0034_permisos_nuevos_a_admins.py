"""Administrador y Superusuario reciben los permisos nuevos del 22/10/2026:
habilitar el rol de pagos y ver todo lo pendiente en «Por aprobar». Solo suma
y es idempotente."""

from django.db import migrations

ROLES = ["Superusuario", "Administrador"]
PERMISOS = ["roles_pago.habilitar", "licencias.ver_por_aprobar"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    permisos = Permission.objects.filter(
        content_type__app_label="permissions", codename__in=PERMISOS
    )
    for rol in Group.objects.filter(name__in=ROLES):
        rol.permissions.add(*permisos)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("roles", "0033_permisos_institucional_por_cargo")]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
