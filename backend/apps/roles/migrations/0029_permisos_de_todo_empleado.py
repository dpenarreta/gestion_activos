"""Todo acceso pasa por un permiso (21/10/2026).

- **Administrador** y **Superusuario** reciben los permisos nuevos.
- Los **roles de nivel** del organigrama (todo empleado tiene uno por su
  cargo) reciben los de todo empleado: lo que antes bastaba con tener sesión
  —solicitar permisos, consultar su rol de pagos, reportar sugerencias y pedir
  ayuda en Soporte TI— ahora es un permiso, y se puede quitar.

Solo suma y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

ADMINISTRACION = ["Superusuario", "Administrador"]
NUEVOS = [
    "licencias.solicitar",
    "roles_pago.consultar",
    "sugerencias.reportar",
    "soporte.solicitar",
    "dashboard.reasignar_dueno",
    "dashboard.administrar_acceso",
    "dashboard.desbloquear",
]
BASE = ["licencias.solicitar", "roles_pago.consultar", "sugerencias.reportar", "soporte.solicitar"]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    NivelJerarquico = apps.get_model("organizacion", "NivelJerarquico")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
    nuevos = Permission.objects.filter(content_type=tipo, codename__in=NUEVOS)
    for rol in Group.objects.filter(name__in=ADMINISTRACION):
        rol.permissions.add(*nuevos)
    base = Permission.objects.filter(content_type=tipo, codename__in=BASE)
    de_nivel = NivelJerarquico.objects.exclude(rol=None).values_list("rol_id", flat=True)
    for rol in Group.objects.filter(pk__in=list(de_nivel)):
        rol.permissions.add(*base)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0028_permiso_modulos"),
        ("permissions", "0035_permisos_de_todo_empleado"),
        ("organizacion", "0027_correo_personal"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
