"""Los administradores de TI no entran a las Reuniones de Gestión Humana
(06/11/2026).

Misma decisión del usuario del 05/11/2026 que `tasks/0003` y
`mejora_continua/0003`: el rol «Administrador» no entra a lo de Gestión Humana
que no es de TI; el «Superusuario» sí. En una base nueva, `roles/0007` crea el
Administrador con el catálogo completo de ese momento, que ya trae
`reuniones.*`: aquí se le quitan. `crear_roles_iniciales` también excluye el
prefijo.

Al revertir, se le devuelven.
"""

from django.db import migrations

ROL = "Administrador"


def _del_modulo(apps):
    from django.db.models import Q

    Permission = apps.get_model("auth", "Permission")
    # Sin regex: SQL Server no la admite en una consulta.
    return Permission.objects.filter(content_type__app_label="permissions").filter(
        Q(codename__startswith="reuniones.")
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
        ("reuniones", "0002_permisos_por_rol"),
    ]

    operations = [migrations.RunPython(quitar, devolver)]
