"""Los permisos de Reuniones para los roles de Gestión Humana (06/11/2026).

En Nexo, ver las reuniones propias no pedía permiso (toda cuenta era del
departamento) y crear una pedía `reuniones.crear`, de ADMINISTRADOR,
JEFE_NACIONAL, COORDINADOR_NACIONAL y COORDINADOR_ZS (su `permissions/0003`).
Aquí, con el mismo reparto:

- `reuniones.acceder` (ver las propias y poder ser invitado): los diez roles
  del departamento.
- `reuniones.crear`: Jefe Nacional, Coordinador Nacional y Coordinador ZS, los
  que ya programaban reuniones en Nexo.
- `reuniones.administrar` (nuevo: ver y tocar las de otros): solo el
  Administrador de Gestión Humana y el Superusuario.
- El Administrador de Gestión Humana y el Superusuario: todo `reuniones.*`.
- El rol «Administrador» (TI): nada. Se lo quita `reuniones/0003`.

Crea los permisos del catálogo que falten (el `post_migrate` corre al final de
todo el `migrate`), solo suma y es idempotente. Al revertir quita solo lo que
esta migración dio, sin tocar los roles.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PREFIJO = "reuniones."
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
    "reuniones.acceder": TODOS_LOS_ROLES,
    "reuniones.crear": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"],
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
    # Sin regex: SQL Server no la admite en una consulta.
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


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    del_modulo = _del_modulo(apps)
    for rol in Group.objects.filter(name__in=[*TODOS_LOS_ROLES, *CON_TODO]):
        rol.permissions.remove(*del_modulo)


class Migration(migrations.Migration):
    dependencies = [
        ("reuniones", "0001_initial"),
        ("permissions", "0052_permisos_de_reuniones_y_escritorio"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("mejora_continua", "0003_sin_mejora_continua_para_administrador_de_ti"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
