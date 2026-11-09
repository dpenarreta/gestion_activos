"""Los permisos de Nova (la IA de Gestión Humana) para los roles que ya usan
cada función (09/11/2026).

- `nova.analisis_kpi` y `nova.mensaje_inicio`: a todo rol que tiene
  `kpi.acceder` (en Nexo, toda cuenta veía Nova en sus KPI y en su inicio).
- `nova.narrativa_informes`: a todo rol que tiene `informes_gh.generar` (en
  Nexo, la narrativa con IA salía en todo informe generado).

Se conceden por el permiso que el rol ya tiene, no por nombre: así siguen el
reparto que cada empresa haya hecho en Configuración › Roles. El rol
«Administrador» (TI) no tiene KPI ni informes y no recibe nada
(`crear_roles_iniciales` excluye `nova.`). Desde Configuración › Roles se le
quita a quien no deba usar la IA. Sin clave de IA configurada, tenerlos solo
muestra la versión sin IA.

Solo suma y es idempotente. Revertirla los quita de todos los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

#: permiso de Nova → permiso que el rol ya debe tener para recibirlo.
POR_PERMISO = {
    "nova.analisis_kpi": "kpi.acceder",
    "nova.mensaje_inicio": "kpi.acceder",
    "nova.narrativa_informes": "informes_gh.generar",
}


def _permisos(apps, codenames):
    """Los `auth.Permission` pedidos, creando los del catálogo que falten (el
    `post_migrate` corre después)."""
    configuracion = apps.get_app_config("permissions")
    # Con el registro histórico `models_module` es None y `create_permissions`
    # no haría nada; se restaura después.
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes

    Permission = apps.get_model("auth", "Permission")
    return {
        p.codename: p
        for p in Permission.objects.filter(
            content_type__app_label="permissions", codename__in=codenames
        )
    }


def conceder(apps, schema_editor):
    permisos = _permisos(apps, [*POR_PERMISO, *POR_PERMISO.values()])
    Group = apps.get_model("auth", "Group")
    for nova, requisito in POR_PERMISO.items():
        if nova not in permisos or requisito not in permisos:
            continue
        for rol in Group.objects.filter(permissions=permisos[requisito]).exclude(
            permissions=permisos[nova]
        ):
            rol.permissions.add(permisos[nova])


def retirar(apps, schema_editor):
    permisos = _permisos(apps, list(POR_PERMISO))
    Group = apps.get_model("auth", "Group")
    for permiso in permisos.values():
        for rol in Group.objects.filter(permissions=permiso):
            rol.permissions.remove(permiso)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0040_permiso_crear_tickets"),
        ("permissions", "0055_permisos_nova"),
        # Los roles de Gestión Humana con `kpi.acceder` e `informes_gh.generar`.
        ("analytics", "0002_permisos_por_rol"),
        ("informes", "0003_sin_informes_para_administrador_de_ti"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
