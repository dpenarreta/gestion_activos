"""Los administradores de TI no ven las Tareas de Gestión Humana (05/11/2026).

`0002` dio todo `tareas.*` y `equipo.*` a los roles «Administrador» y
«Superusuario», por la convención de cada módulo nuevo. Con
`tareas.administrar` eso dejaba a un administrador de TI ver todas las tareas
y horas del equipo de Gestión Humana. Decisión del usuario: el rol
«Administrador» no tiene acceso a Tareas; el «Superusuario» sí. Quien
administra el módulo es el «Administrador de Gestión Humana».

Al revertir, se le devuelven.
"""

from django.db import migrations

ROL = "Administrador"


def _del_modulo(apps):
    from django.db.models import Q

    Permission = apps.get_model("auth", "Permission")
    # Sin regex: SQL Server no la admite en una consulta.
    return Permission.objects.filter(content_type__app_label="permissions").filter(
        Q(codename__startswith="tareas.") | Q(codename__startswith="equipo.")
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
        ("tasks", "0002_permisos_por_rol"),
    ]

    operations = [migrations.RunPython(quitar, devolver)]
