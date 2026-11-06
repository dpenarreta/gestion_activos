"""Los permisos de Informes ejecutivos para los roles de Gestión Humana (06/11/2026).

En Nexo había uno solo, `reportes.ver` («ver y generar reportes ejecutivos»),
de ADMINISTRADOR, JEFE_NACIONAL y COORDINADOR_NACIONAL (su `permissions/0003`).
Aquí se separa en tres, con el mismo reparto:

- `informes_gh.ver` y `informes_gh.generar`: Jefe Nacional y Coordinador
  Nacional (lo que cada uno incluye lo decide su equipo en el organigrama).
- `informes_gh.administrar` (alcance completo; en Nexo, el ADMINISTRADOR =
  superusuario): nadie del departamento.
- El Administrador de Gestión Humana y el Superusuario: todo `informes_gh.*`.
- El rol «Administrador» (TI): nada. Se lo quita `informes/0003`.

Crea los permisos del catálogo que falten (el `post_migrate` corre al final de
todo el `migrate`), solo suma y es idempotente. Al revertir quita solo lo que
esta migración dio, sin tocar los roles.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PREFIJO = "informes_gh."
ADMIN_GH = "Administrador de Gestión Humana"
CON_TODO = [ADMIN_GH, "Superusuario"]

POR_PERMISO = {
    "informes_gh.ver": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
    "informes_gh.generar": ["JEFE_NACIONAL", "COORDINADOR_NACIONAL"],
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
    roles = {nombre for nombres in POR_PERMISO.values() for nombre in nombres}
    for rol in Group.objects.filter(name__in=[*roles, *CON_TODO]):
        rol.permissions.remove(*del_modulo)


class Migration(migrations.Migration):
    dependencies = [
        ("informes", "0001_initial"),
        ("permissions", "0050_permisos_de_informes"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("analytics", "0002_permisos_por_rol"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
