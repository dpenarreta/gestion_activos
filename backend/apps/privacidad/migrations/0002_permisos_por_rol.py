"""Quién atiende las solicitudes de derechos sobre datos personales (09/11/2026).

En Nexo las gestionaba el ADMINISTRADOR (`is_administrator`). Aquí, por
decisión del usuario:

- el Administrador de Gestión Humana y el Superusuario: todo `privacidad.*`
  (`ver` y `atender`). Gestión Humana es quien responde por los datos de las
  personas de la empresa;
- el rol «Administrador» (TI): nada. Se lo quita `privacidad/0003`: atender
  abre los datos de cualquier persona, y administrar el sistema no lo requiere;
- nadie más: pedir y descargar lo propio no pide permiso.

Crea los permisos del catálogo que falten (el `post_migrate` corre al final de
todo el `migrate`), solo suma y es idempotente. Al revertir quita solo lo que
esta migración dio, sin tocar los roles.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PREFIJO = "privacidad."
ADMIN_GH = "Administrador de Gestión Humana"
CON_TODO = [ADMIN_GH, "Superusuario"]


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
    admin_gh, _ = Group.objects.get_or_create(name=ADMIN_GH)
    admin_gh.permissions.add(*del_modulo)
    # El Superusuario solo si ya existe: crearlo aquí haría que
    # `crear_roles_iniciales` lo diera por configurado con solo esto.
    for rol in Group.objects.filter(name="Superusuario"):
        rol.permissions.add(*del_modulo)


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    del_modulo = _del_modulo(apps)
    for rol in Group.objects.filter(name__in=CON_TODO):
        rol.permissions.remove(*del_modulo)


class Migration(migrations.Migration):
    dependencies = [
        ("privacidad", "0001_initial"),
        ("permissions", "0053_permisos_de_privacidad"),
        ("novedades", "0004_roles_de_gestion_humana"),
        ("escritorio", "0003_sin_escritorio_para_administrador_de_ti"),
        ("roles", "0039_permiso_descargas_a_admins"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
