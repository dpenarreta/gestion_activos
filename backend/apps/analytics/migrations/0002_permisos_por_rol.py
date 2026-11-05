"""Los permisos de KPI e Inteligencia Preventiva para los roles de Gestión
Humana (05/11/2026).

En Nexo el motor no tenía permisos del catálogo salvo
`inteligencia_preventiva.ver`: decidía por el nivel del rol
(`src/lib/roles.ts`, `apps.hierarchy.services`). Aquí cada chequeo es un
permiso, con el mismo reparto:

- `kpi.acceder` (en Nexo, toda cuenta veía sus KPI): los diez roles del
  departamento.
- `kpi.equipo` (en Nexo, `can_view_team`: nivel >= 2): Jefe Nacional,
  Coordinador Nacional, Coordinador ZS, Analista de Clima y Cultura y Analista
  de Selección (los mismos de `equipo.ver`).
- `kpi.ejecutivo` (en Nexo, `is_leadership`: nivel >= 3): Jefe Nacional y
  Coordinador Nacional.
- `inteligencia_preventiva.ver` (en Nexo, `CAN_VIEW_OPERATIONAL_RISK`): Jefe
  Nacional, Coordinador Nacional y Coordinador ZS.
- `kpi.administrar` (en Nexo, el ADMINISTRADOR = superusuario): nadie del
  departamento.
- El Administrador de Gestión Humana y el Superusuario: todo.
- El rol «Administrador» (TI): nada. Decisión del usuario del 05/11/2026, la
  misma de `tasks/0003`.

Crea los permisos del catálogo que falten, solo suma y es idempotente. Al
revertir quita solo lo que esta migración dio, sin tocar los roles.
"""

from django.db import migrations
from django.db.models import Q

from apps.permissions.catalog import as_django_permission_tuples

PREFIJOS = ("kpi.", "inteligencia_preventiva.")
ADMIN_GH = "Administrador de Gestión Humana"
CON_TODO = [ADMIN_GH, "Superusuario"]

TODOS_LOS_ROLES = [
    "JEFE_NACIONAL",
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
]

POR_PERMISO = {
    "kpi.acceder": TODOS_LOS_ROLES,
    "kpi.equipo": [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    ],
    "kpi.ejecutivo": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "inteligencia_preventiva.ver": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"],
}


def _del_modulo(apps):
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        if codename.startswith(PREFIJOS):
            Permission.objects.get_or_create(
                content_type=tipo, codename=codename, defaults={"name": nombre}
            )
    # Sin regex: SQL Server no la admite en una consulta.
    return Permission.objects.filter(content_type=tipo).filter(
        Q(codename__startswith=PREFIJOS[0]) | Q(codename__startswith=PREFIJOS[1])
    )


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    del_modulo = _del_modulo(apps)

    for codename, roles in POR_PERMISO.items():
        permiso = del_modulo.get(codename=codename)
        for nombre in roles:
            rol, _ = Group.objects.get_or_create(name=nombre)
            rol.permissions.add(permiso)

    admin_gh, _ = Group.objects.get_or_create(name=ADMIN_GH)
    admin_gh.permissions.add(*del_modulo)
    # El Superusuario solo si ya existe: crearlo aquí haría que
    # `crear_roles_iniciales` lo diera por configurado con solo esto.
    for rol in Group.objects.filter(name="Superusuario"):
        rol.permissions.add(*del_modulo)
    # En una base nueva, `roles/0007` crea el Administrador con el catálogo
    # completo de ese momento, que ya trae estos permisos: se le quitan.
    for rol in Group.objects.filter(name="Administrador"):
        rol.permissions.remove(*del_modulo)


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    del_modulo = _del_modulo(apps)
    for rol in Group.objects.filter(name__in=[*TODOS_LOS_ROLES, *CON_TODO]):
        rol.permissions.remove(*del_modulo)


class Migration(migrations.Migration):
    dependencies = [
        ("analytics", "0001_initial"),
        ("permissions", "0047_permisos_de_kpi"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("tasks", "0003_sin_tareas_para_administrador_de_ti"),
        ("ausencias", "0002_permisos_por_rol"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
