"""Los permisos de Proyectos para los roles de Gestión Humana (05/11/2026).

Los roles ya existen (`novedades/0003` y `novedades/0004`); aquí reciben lo
que tenían en Nexo (su matriz `permissions/0003` y los niveles de
`src/lib/roles.ts`):

- `proyectos_gh.acceder`: todos (en Nexo, toda cuenta veía sus proyectos).
- `proyectos_gh.crear` (en Nexo, `proyectos.crear`: nivel >= 2): Jefe
  Nacional, Coordinador Nacional, Coordinador ZS, Analista de Clima y Cultura
  y Analista de Selección.
- `proyectos_gh.supervisar` (en Nexo, el «liderazgo», nivel >= 3, que
  gestionaba cualquier proyecto; aquí, los de su equipo según el
  organigrama): Jefe Nacional y Coordinador Nacional.
- `proyectos_gh.administrar` (en Nexo, el ADMINISTRADOR = superusuario):
  nadie del departamento.
- El Administrador de Gestión Humana y el Superusuario: todo `proyectos_gh.*`.
- El rol «Administrador» (TI): nada. Decisión del usuario del 05/11/2026,
  la misma de `tasks/0003`.

Crea los permisos del catálogo que falten (el `post_migrate` corre al final de
todo el `migrate`), solo suma y es idempotente. Al revertir quita solo lo que
esta migración dio, sin tocar los roles.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PREFIJO = "proyectos_gh."
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
    "proyectos_gh.acceder": TODOS_LOS_ROLES,
    "proyectos_gh.crear": [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    ],
    "proyectos_gh.supervisar": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
}


def _del_modulo(apps):
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        if codename.startswith(PREFIJO):
            Permission.objects.get_or_create(
                content_type=tipo, codename=codename, defaults={"name": nombre}
            )
    return Permission.objects.filter(content_type=tipo, codename__startswith=PREFIJO)


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
        ("projects", "0001_initial"),
        ("permissions", "0046_permisos_de_proyectos_y_ausencias"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("tasks", "0003_sin_tareas_para_administrador_de_ti"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
