"""Los roles operativos de Control Operativo de Novedades y sus permisos.

Como en Nexo (sus migraciones `novedades/0002`, `0007` y `0009`), los tres
roles son `auth.Group` con estos nombres exactos, porque el módulo los
reconoce por nombre (`apps.novedades.access.OPERATIONAL_ROLES`). En la
intranet se asignan como cualquier rol: globales o en la membresía de una
empresa.

Permisos de partida (los del catálogo `novedades.*`; la matriz por rol de
`access.ROLE_MATRIX` decide además cuáles son obligatorios o no disponibles):

- SUPERVISOR_OPERACIONES: acceder, gestionar colaboradores, registrar,
  historial y cerrar período. Importar, exportar y consolidado arrancan
  apagados, como en Nexo: se habilitan expresamente desde los Ajustes.
- ASISTENTE_OPERACIONES: acceder, consolidado, historial, exportar y
  registrar (decisión de Nexo del 13/10/2026).
- JEFE_OPERACIONES: acceder, consolidado y depurar.
- Administrador y Superusuario: todo `novedades.*`, como con cada módulo.

Crea los permisos del catálogo que falten (el `post_migrate` que los crea
corre al final de todo el `migrate`), solo suma y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

SUPERVISOR = "SUPERVISOR_OPERACIONES"
ASISTENTE = "ASISTENTE_OPERACIONES"
JEFE = "JEFE_OPERACIONES"

POR_ROL = {
    SUPERVISOR: [
        "novedades.acceder",
        "novedades.colaboradores_gestionar",
        "novedades.registrar",
        "novedades.historial_ver",
        "novedades.cerrar_periodo",
    ],
    ASISTENTE: [
        "novedades.acceder",
        "novedades.consolidado_ver",
        "novedades.historial_ver",
        "novedades.exportar",
        "novedades.registrar",
    ],
    JEFE: ["novedades.acceder", "novedades.consolidado_ver", "novedades.depurar"],
}
ADMINS = ["Superusuario", "Administrador"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        if codename.startswith("novedades."):
            Permission.objects.get_or_create(
                content_type=tipo, codename=codename, defaults={"name": nombre}
            )
    del_modulo = Permission.objects.filter(content_type=tipo, codename__startswith="novedades.")

    for nombre_rol, codenames in POR_ROL.items():
        rol, _ = Group.objects.get_or_create(name=nombre_rol)
        rol.permissions.add(*del_modulo.filter(codename__in=codenames))

    for rol in Group.objects.filter(name__in=ADMINS):
        rol.permissions.add(*del_modulo)


def quitar(apps, schema_editor):
    """Al revertir solo se borran los roles operativos sin nadie asignado:
    nunca se le quita un rol a una persona."""
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(name__in=list(POR_ROL)):
        if not rol.user_set.exists() and not rol.membresias.exists():
            rol.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("novedades", "0001_initial"),
        ("permissions", "0044_permisos_de_novedades"),
        ("roles", "0039_permiso_descargas_a_admins"),
        ("empresas", "0006_estado_modulo"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
