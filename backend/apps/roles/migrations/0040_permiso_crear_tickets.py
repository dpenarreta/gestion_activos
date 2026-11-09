"""«Crear tickets» (`soporte.crear`) para todos los roles (09/11/2026).

Hasta hoy pedir ayuda en «Soporte TI» lo podía toda cuenta, sin permiso
(`0030_soporte_ti_para_todos`). Pasa a ser un permiso que se puede quitar. Para
que nadie pierda la posibilidad de pedir ayuda el día del cambio, se concede a
**todos los roles** que existen; desde Configuración › Roles se le quita al rol
que no deba crear tickets. Los roles que nacen después de un cargo del
organigrama lo traen de `organizacion.roles_de_cargo.PERMISOS_BASE`;
Administrador y Superusuario, del «todo el catálogo» de `crear_roles_iniciales`.
La cuenta sin ningún rol lo conserva por `authorization.PERMISOS_SIN_ROL`.

Solo suma y es idempotente. Revertirla lo quita de los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

PERMISO = "soporte.crear"


def _permiso(apps):
    """El `auth.Permission` de `soporte.crear`, creándolo si aún no existe (los
    del catálogo los crea `post_migrate`, que corre después)."""
    configuracion = apps.get_app_config("permissions")
    # Con el registro histórico `models_module` es None y `create_permissions`
    # no haría nada; se restaura después (en las pruebas es el registro real).
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes

    Permission = apps.get_model("auth", "Permission")
    return Permission.objects.filter(
        content_type__app_label="permissions", codename=PERMISO
    ).first()


def conceder(apps, schema_editor):
    permiso = _permiso(apps)
    if permiso is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.exclude(permissions=permiso):
        rol.permissions.add(permiso)


def retirar(apps, schema_editor):
    permiso = _permiso(apps)
    if permiso is None:
        return
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(permissions=permiso):
        rol.permissions.remove(permiso)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0039_permiso_descargas_a_admins"),
        ("permissions", "0054_permiso_crear_tickets"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
