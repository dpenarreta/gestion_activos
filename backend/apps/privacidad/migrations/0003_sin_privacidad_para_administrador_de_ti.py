"""Los administradores de TI no atienden las solicitudes de datos personales
(09/11/2026).

Decisión del usuario: las atienden el Administrador de Gestión Humana y el
Superusuario (`privacidad/0002`). En una base nueva, `roles/0007` crea el
Administrador con el catálogo completo de ese momento, que ya trae
`privacidad.*`: aquí se le quitan. `crear_roles_iniciales` también excluye el
prefijo. Si TI tiene que ayudar con una solicitud, se le da el permiso a la
persona, no al rol.

Al revertir, se le devuelven.
"""

from django.db import migrations

ROL = "Administrador"


def _del_modulo(apps):
    Permission = apps.get_model("auth", "Permission")
    # Sin regex: SQL Server no la admite en una consulta.
    return Permission.objects.filter(
        content_type__app_label="permissions", codename__startswith="privacidad."
    )


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    rol = Group.objects.filter(name=ROL).first()
    if rol:
        rol.permissions.remove(*_del_modulo(apps))


def devolver(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    rol = Group.objects.filter(name=ROL).first()
    if rol:
        rol.permissions.add(*_del_modulo(apps))


class Migration(migrations.Migration):
    dependencies = [
        ("privacidad", "0002_permisos_por_rol"),
    ]

    operations = [migrations.RunPython(quitar, devolver)]
