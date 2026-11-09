"""Los permisos del chat y de la base de conocimiento de Nova (09/11/2026),
con el mismo criterio que `0041_permisos_nova`:

- `nova.chat` y `nova.conocimiento_ver`: a todo rol que tiene `kpi.acceder`
  o `tareas.acceder` (en Nexo, toda cuenta tenía el asistente).
- `nova.chat_equipo`: a todo rol que ya ve al equipo (`equipo.ver` o
  `kpi.equipo`). Además, el servidor exige equipo a cargo en el organigrama o
  uno de esos permisos (`apps.nova.access.puede_chat_equipo`).
- `nova.conocimiento_gestionar`: al Administrador de Gestión Humana y al
  Superusuario, por nombre.

El rol «Administrador» (TI) no recibe nada aunque tuviera alguno de esos
permisos (`crear_roles_iniciales` excluye `nova.`), y se le quitan los `nova.*`
que tuviera: en una base nueva los recibía todos con el catálogo completo
(como `informes/0003` y las demás «sin … para el Administrador de TI»). Desde
Configuración › Roles se le quita a quien no deba usar la IA. Sin clave de IA
configurada, el chat solo muestra que Nova no está disponible.

Idempotente. Revertirla quita los permisos nuevos de todos los roles (no
devuelve los `nova.*` al Administrador de TI).
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

ADMINISTRADOR_TI = "Administrador"

#: permiso de Nova → permisos que el rol ya debe tener (cualquiera).
POR_PERMISO = {
    "nova.chat": ("kpi.acceder", "tareas.acceder"),
    "nova.conocimiento_ver": ("kpi.acceder", "tareas.acceder"),
    "nova.chat_equipo": ("equipo.ver", "kpi.equipo"),
}

#: permiso de Nova → roles que lo reciben por nombre.
POR_ROL = {
    "nova.conocimiento_gestionar": ("Administrador de Gestión Humana", "Superusuario"),
}


def _permisos(apps, codenames):
    """Los `auth.Permission` pedidos, creando los del catálogo que falten (el
    `post_migrate` corre después)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes

    Permission = apps.get_model("auth", "Permission")
    return {
        p.codename: p
        for p in Permission.objects.filter(
            content_type__app_label="permissions", codename__in=codenames
        )
    }


def conceder(apps, schema_editor):
    requisitos = {c for lista in POR_PERMISO.values() for c in lista}
    permisos = _permisos(apps, [*POR_PERMISO, *POR_ROL, *requisitos])
    Group = apps.get_model("auth", "Group")
    for nova, previos in POR_PERMISO.items():
        if nova not in permisos:
            continue
        previos = [permisos[c] for c in previos if c in permisos]
        if not previos:
            continue
        roles = (
            Group.objects.filter(permissions__in=previos)
            .exclude(name=ADMINISTRADOR_TI)
            .exclude(permissions=permisos[nova])
            .distinct()
        )
        for rol in roles:
            rol.permissions.add(permisos[nova])
    for nova, nombres in POR_ROL.items():
        if nova not in permisos:
            continue
        for rol in Group.objects.filter(name__in=nombres):
            rol.permissions.add(permisos[nova])

    Permission = apps.get_model("auth", "Permission")
    de_nova = Permission.objects.filter(
        content_type__app_label="permissions", codename__startswith="nova."
    )
    for rol in Group.objects.filter(name=ADMINISTRADOR_TI):
        rol.permissions.remove(*de_nova)


def retirar(apps, schema_editor):
    permisos = _permisos(apps, [*POR_PERMISO, *POR_ROL])
    Group = apps.get_model("auth", "Group")
    for permiso in permisos.values():
        for rol in Group.objects.filter(permissions=permiso):
            rol.permissions.remove(permiso)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0041_permisos_nova"),
        ("permissions", "0056_permisos_nova_chat"),
        # Los roles de Gestión Humana con `tareas.acceder`, `equipo.ver`,
        # `kpi.acceder` y `kpi.equipo`.
        ("tasks", "0003_sin_tareas_para_administrador_de_ti"),
        ("analytics", "0002_permisos_por_rol"),
        # El rol «Administrador de Gestión Humana».
        ("novedades", "0003_rol_administrador_gestion_humana"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
