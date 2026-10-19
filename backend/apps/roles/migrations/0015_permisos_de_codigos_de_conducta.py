"""Los códigos de conducta pasan a tener su propio bloque de permisos.

- `institucional.documentos` se **renombra** a `codigos.publicar` (se cambia
  el código del mismo permiso, así ningún rol ni cuenta lo pierde).
- Quien lo tenía —rol o cuenta con permisos propios— recibe además
  `codigos.acuerdo` y `codigos.ver_aceptaciones`: antes todo eso iba en uno solo.
- **Superusuario** y **Administrador**: los tres.
- **Consulta / Auditoría**: `codigos.ver_aceptaciones`, que es solo consultar
  quién aceptó el acuerdo y cuándo.

Solo suma (no quita nada a nadie) y es idempotente.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

VIEJO = "institucional.documentos"
NUEVO = "codigos.publicar"
SUMADOS = ["codigos.acuerdo", "codigos.ver_aceptaciones"]
POR_ROL = {
    "Superusuario": [NUEVO, *SUMADOS],
    "Administrador": [NUEVO, *SUMADOS],
    "Consulta / Auditoría": ["codigos.ver_aceptaciones"],
}


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    User = apps.get_model("users", "User")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    nombres = dict(as_django_permission_tuples())

    # Primero el renombre, antes de crear los que falten: si no, se crearía
    # un `codigos.publicar` vacío y el viejo quedaría con las asignaciones.
    viejo = Permission.objects.filter(content_type=tipo, codename=VIEJO).first()
    if viejo and not Permission.objects.filter(content_type=tipo, codename=NUEVO).exists():
        viejo.codename = NUEVO
        viejo.name = nombres[NUEVO]
        viejo.save(update_fields=["codename", "name"])

    for codename, nombre in nombres.items():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )

    publicar = Permission.objects.get(content_type=tipo, codename=NUEVO)
    sumados = list(Permission.objects.filter(content_type=tipo, codename__in=SUMADOS))
    for rol in Group.objects.filter(permissions=publicar):
        rol.permissions.add(*sumados)
    for cuenta in User.objects.filter(user_permissions=publicar).distinct():
        cuenta.user_permissions.add(*sumados)

    for nombre_rol, codenames in POR_ROL.items():
        rol = Group.objects.filter(name=nombre_rol).first()
        if rol is not None:
            rol.permissions.add(
                *Permission.objects.filter(content_type=tipo, codename__in=codenames)
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0014_permiso_documentos_institucionales"),
        ("permissions", "0021_permisos_de_codigos_de_conducta"),
        ("users", "0002_ultima_conexion_desde_los_intentos"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
