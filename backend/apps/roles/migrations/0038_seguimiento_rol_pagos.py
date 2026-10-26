"""«Roles sin abrir» del rol de pagos (26/10/2026).

`roles_pago.seguimiento` va a Administrador, Superusuario y a los roles de los
cargos de Gestión Humana (`GH_FIJOS` en `apps.organizacion.permisos_por_cargo`).
Solo suma; es idempotente.
"""

from django.db import migrations

from apps.organizacion.permisos_por_cargo import REGLAS, normalizar
from apps.permissions.catalog import as_django_permission_tuples

PERMISO = "roles_pago.seguimiento"
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
    elegidos = {normalizar(c) for c in REGLAS[PERMISO]}
    for cargo in Cargo.objects.exclude(rol=None).select_related("rol"):
        if elegidos & {normalizar(cargo.nombre), normalizar(cargo.rol.name)}:
            cargo.rol.permissions.add(permiso)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0037_permisos_proyectos_a_admins"),
        ("permissions", "0042_permiso_seguimiento_rol"),
        ("organizacion", "0031_detalle_herramienta_de_usuario"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
