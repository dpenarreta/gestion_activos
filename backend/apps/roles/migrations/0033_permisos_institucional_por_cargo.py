"""Permisos del módulo Institucional por cargo (22/10/2026).

Aplica «PERMISOS – MÓDULO INSTITUCIONAL» de Gestión Humana:

1. Cada rol de cargo recibe los permisos que su cargo lleva según la tabla de
   `apps.organizacion.permisos_por_cargo` (Gestión Humana, TI…).
2. Consultar el propio rol de pagos deja de darse por rol: se quita de todos
   los roles (también de Administrador y Superusuario) y queda persona por
   persona. Quienes ya lo habían consultado —aceptaron los términos— quedan
   habilitados para no perder el acceso.

La tabla se importa de la app a propósito, como el catálogo: es la definición
del pedido y una migración posterior la usaría igual.
"""

from django.db import migrations

from apps.organizacion.permisos_por_cargo import REGLAS, SOLO_POR_PERSONA, normalizar
from apps.permissions.catalog import as_django_permission_tuples


def aplicar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    Cargo = apps.get_model("organizacion", "Cargo")
    User = apps.get_model("users", "User")
    ConsultaRolPagos = apps.get_model("nomina", "ConsultaRolPagos")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
    permisos = {p.codename: p for p in Permission.objects.filter(content_type=tipo)}

    por_cargo = {}
    for codename, cargos in REGLAS.items():
        for cargo in cargos:
            por_cargo.setdefault(normalizar(cargo), set()).add(codename)
    for cargo in Cargo.objects.exclude(rol=None).select_related("rol"):
        debidos = por_cargo.get(normalizar(cargo.nombre), set())
        cargo.rol.permissions.add(*[permisos[c] for c in debidos if c in permisos])

    for codename in SOLO_POR_PERSONA:
        permiso = permisos.get(codename)
        if permiso is None:
            continue
        for rol in Group.objects.filter(permissions=permiso):
            rol.permissions.remove(permiso)
        ya_consultaron = ConsultaRolPagos.objects.values_list("usuario_id", flat=True)
        for usuario in User.objects.filter(pk__in=list(ya_consultaron)):
            usuario.user_permissions.add(permiso)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0032_organigrama_de_su_area"),
        ("permissions", "0038_permisos_institucional_por_cargo"),
        ("nomina", "0004_observaciones"),
        ("users", "0003_codigo_empleado"),
    ]

    operations = [migrations.RunPython(aplicar, noop_reverse)]
