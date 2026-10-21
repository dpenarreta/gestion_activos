"""Roles fuera del organigrama: solo Administrador y Superusuario (21/10/2026).

Desde que los roles salen de los cargos del organigrama, los roles
«plantilla» (Técnico de mesa de ayuda, Talento Humano, Soporte TI…) sobran:
los permisos se marcan en el rol de cada cargo. Se borran los que **nadie
tiene asignado** (ni global ni en una empresa); uno asignado se conserva.

Quedan, aparte de los de cargo, **Administrador** y **Superusuario** (todo el
catálogo), para poder asignar a alguien la administración del sistema. Los
que alguien ya tiene, como «Responsable de cumplimiento», se respetan.
"""

from django.db import migrations

from apps.permissions.catalog import as_django_permission_tuples

PLANTILLAS = [
    "Coordinador de mesa de ayuda",
    "Técnico de mesa de ayuda",
    "Coordinador de órdenes de trabajo",
    "Técnico de órdenes de trabajo",
    "Talento Humano",
    "Soporte TI",
    "Supervisor TI",
    "Consulta / Auditoría",
    "Usuario final",
    "Supervisor de cumplimiento",
]


def sembrar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")
    MembresiaEmpresa = apps.get_model("empresas", "MembresiaEmpresa")

    tipo, _ = ContentType.objects.get_or_create(app_label="permissions", model="modulepermission")
    codenames = []
    for codename, nombre in as_django_permission_tuples():
        Permission.objects.get_or_create(
            content_type=tipo, codename=codename, defaults={"name": nombre}
        )
        codenames.append(codename)
    superusuario, _ = Group.objects.get_or_create(name="Superusuario")
    superusuario.permissions.add(
        *Permission.objects.filter(content_type=tipo, codename__in=codenames)
    )

    for rol in Group.objects.filter(name__in=PLANTILLAS):
        asignado = rol.user_set.exists() or MembresiaEmpresa.objects.filter(roles=rol).exists()
        if not asignado:
            rol.delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0030_soporte_ti_para_todos"),
        ("empresas", "0006_estado_modulo"),
    ]

    operations = [migrations.RunPython(sembrar, noop_reverse)]
