"""Los roles del equipo de Gestión Humana que vienen de Nexo (04/11/2026).

En Nexo cada persona del departamento tiene un rol por su cargo (jefe y
coordinadores nacionales, analistas, asistentes, trabajo social, nómina).
Esos roles mandan en Tareas, carga laboral y KPI, que todavía no están en la
intranet; en el Control Operativo de Novedades no tenían permisos (solo el
Administrador y los roles de operaciones).

Se crean ya, con los mismos nombres de Nexo, para que cada persona quede
desde hoy con su rol: sus permisos llegan cuando se porte cada parte, sin
tener que reasignar a nadie. Hoy no conceden nada.

Solo suma y es idempotente; al revertir se borran solo los que nadie tiene.
"""

from django.db import migrations

ROLES = [
    "JEFE_NACIONAL",
    "COORDINADOR_NACIONAL",
    "COORDINADOR_ZS",
    "ANALISTA_CC",
    "ANALISTA_SELECCION",
    "ASISTENTE_SELECCION",
    "ASISTENTE_GH",
    "ASISTENTE_GH_ZS",
    "TRABAJO_SOCIAL",
    "ASISTENTE_NOMINA",
]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for nombre in ROLES:
        Group.objects.get_or_create(name=nombre)


def quitar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(name__in=ROLES):
        if not rol.user_set.exists() and not rol.membresias.exists():
            rol.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("novedades", "0003_rol_administrador_gestion_humana"),
    ]

    operations = [migrations.RunPython(sembrar, quitar)]
