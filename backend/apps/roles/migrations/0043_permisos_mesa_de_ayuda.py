"""«Ver sus tickets en la Mesa de ayuda» y «Crear tickets en la Mesa de ayuda»
para todos los roles (09/11/2026).

Hasta hoy la bandeja de la Mesa la abría toda cuenta para ver «Mis
solicitudes», y «Pedir ayuda (a mi nombre)» colgaba de `soporte.crear`. El
usuario los separa: `soporte.mesa_mis_tickets` (entrar a la bandeja solo en
«Mis solicitudes») y `soporte.mesa_crear` (crear un ticket a su nombre desde la
Mesa); `soporte.crear` queda solo para «Soporte TI». Ninguno hace a nadie parte
del equipo de la mesa.

Para que nadie pierda nada el día del cambio, se conceden **a todos los roles**
que existen (como `0040_permiso_crear_tickets`); desde Configuración › Roles se
le quitan al rol que no deba tenerlos. Los roles que nacen de un cargo los traen
de `organizacion.roles_de_cargo.PERMISOS_BASE`; Administrador y Superusuario,
del «todo el catálogo» de `crear_roles_iniciales`; la cuenta sin ningún rol, de
`authorization.PERMISOS_SIN_ROL`.

Solo suma y es idempotente. Revertirla los quita de los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

PERMISOS = ("soporte.mesa_mis_tickets", "soporte.mesa_crear")


def _permisos(apps):
    """Los `auth.Permission` nuevos, creándolos si aún no existen (los del
    catálogo los crea `post_migrate`, que corre después)."""
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
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=PERMISOS)
    )


def conceder(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for permiso in _permisos(apps):
        for rol in Group.objects.exclude(permissions=permiso):
            rol.permissions.add(permiso)


def retirar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for permiso in _permisos(apps):
        for rol in Group.objects.filter(permissions=permiso):
            rol.permissions.remove(permiso)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0042_permisos_nova_chat"),
        ("permissions", "0057_permisos_mesa_de_ayuda"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
