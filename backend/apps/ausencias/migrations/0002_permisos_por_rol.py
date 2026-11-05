"""Los permisos de Ausencias para los roles de Gestión Humana (05/11/2026).

En Nexo los permisos y los estados especiales los veía y registraba solo el
superusuario (ADMINISTRADOR); los jefes veían en el KPI de su equipo las
ausencias reducidas a «ausencia justificada», sin el tipo. Aquí:

- `ausencias.ver` (las de su equipo según el organigrama, enmascaradas): los
  roles que en Nexo veían el equipo (`canViewTeam`, nivel >= 2, los mismos de
  `equipo.ver`): Jefe Nacional, Coordinador Nacional, Coordinador ZS, Analista
  de Clima y Cultura y Analista de Selección.
- `ausencias.gestionar`, `ausencias.medicas_ver`,
  `ausencias.medicas_gestionar` y `ausencias.estados_gestionar` (lo que en
  Nexo era del superusuario): el Administrador de Gestión Humana y el
  Superusuario. Nadie más del departamento: el dato médico se da persona por
  persona o rol por rol, a propósito.
- El rol «Administrador» (TI): nada. Decisión del usuario del 05/11/2026,
  la misma de `tasks/0003`.

Solo suma y es idempotente. Al revertir quita solo lo que esta migración dio.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PREFIJO = "ausencias."
ADMIN_GH = "Administrador de Gestión Humana"
CON_TODO = [ADMIN_GH, "Superusuario"]

VEN_SU_EQUIPO = [
    "JEFE_NACIONAL",
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
]


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
    ver = del_modulo.get(codename="ausencias.ver")
    for nombre in VEN_SU_EQUIPO:
        rol, _ = Group.objects.get_or_create(name=nombre)
        rol.permissions.add(ver)
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
    for rol in Group.objects.filter(name__in=[*VEN_SU_EQUIPO, *CON_TODO]):
        rol.permissions.remove(*del_modulo)


class Migration(migrations.Migration):
    dependencies = [
        ("ausencias", "0001_initial"),
        ("permissions", "0046_permisos_de_proyectos_y_ausencias"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("tasks", "0003_sin_tareas_para_administrador_de_ti"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
