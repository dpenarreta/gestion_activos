"""Los permisos de Tareas y Equipo para los roles de Gestión Humana (04/11/2026).

Los roles ya existen (`novedades/0004_roles_de_gestion_humana`, sin permisos, y
`novedades/0003`, el Administrador de Gestión Humana); aquí reciben lo que
tenían en Nexo, según su matriz por rol (`permissions/0003` de Nexo) y los
niveles de `src/lib/roles.ts`:

- `tareas.acceder`: todos (en Nexo, toda cuenta usaba Tareas).
- `tareas.validar` (en Nexo, `usuarios.editar` = `CAN_MANAGE_USERS`):
  Jefe Nacional y Coordinador Nacional.
- `tareas.regularizar`: Jefe Nacional.
- `tareas.cerrar_mes`: Jefe Nacional y Coordinador Nacional.
- `equipo.ver` (en Nexo, `canViewTeam`: nivel >= 2): Jefe Nacional,
  Coordinador Nacional, Coordinador ZS, Analista de Clima y Cultura y Analista
  de Selección.
- `tareas.administrar` (en Nexo, el ADMINISTRADOR = superusuario): nadie del
  departamento.
- El Administrador de Gestión Humana: todo `tareas.*` y `equipo.*`.
- Administrador y Superusuario: todo, como con cada módulo nuevo (en una
  instalación nueva ya lo reciben de `crear_roles_iniciales`).

Crea los permisos del catálogo que falten (el `post_migrate` corre al final de
todo el `migrate`), solo suma y es idempotente. Al revertir quita solo lo que
esta migración dio, sin tocar los roles.
"""

from django.db import migrations
from django.db.models import Q

from apps.permissions.catalog import as_django_permission_tuples

ADMIN_GH = "Administrador de Gestión Humana"
ADMINS = ["Superusuario", "Administrador"]

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
    "tareas.acceder": TODOS_LOS_ROLES,
    "tareas.validar": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "tareas.regularizar": ["JEFE_NACIONAL"],
    "tareas.cerrar_mes": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "equipo.ver": [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    ],
}


def _del_modulo(apps):
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        if codename.startswith(("tareas.", "equipo.")):
            Permission.objects.get_or_create(
                content_type=tipo, codename=codename, defaults={"name": nombre}
            )
    return Permission.objects.filter(content_type=tipo).filter(
        Q(codename__startswith="tareas.") | Q(codename__startswith="equipo.")
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
    for rol in Group.objects.filter(name__in=ADMINS):
        rol.permissions.add(*del_modulo)


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    del_modulo = _del_modulo(apps)
    for rol in Group.objects.filter(name__in=[*TODOS_LOS_ROLES, ADMIN_GH, *ADMINS]):
        rol.permissions.remove(*del_modulo)


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0001_initial"),
        ("permissions", "0045_permisos_de_tareas_y_equipo"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
