"""Soporte TI vuelve a ser de todo usuario (21/10/2026).

El mismo día se había puesto detrás de `soporte.solicitar`; se decidió que
pedir ayuda, como el chat, lo puede cualquiera, tenga el rol que tenga. El
permiso deja de existir: se borra, y con él se quita de los roles que lo
tenían.
"""

from django.db import migrations


def borrar(apps, schema_editor):
    Permission = apps.get_model("auth", "Permission")
    Permission.objects.filter(
        content_type__app_label="permissions", codename="soporte.solicitar"
    ).delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0029_permisos_de_todo_empleado"),
        ("permissions", "0036_soporte_ti_para_todos"),
    ]

    operations = [migrations.RunPython(borrar, noop_reverse)]
