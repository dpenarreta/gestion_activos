"""Los permisos de los llamados de atención (US-013, 12/11/2026).

Todo lo nuevo nace con sus permisos (regla del usuario, CA-9):

- **`llamados.ver`, `llamados.emitir` y `llamados.configurar`** a los roles de
  Gestión Humana —«Coordinador Nacional de GGHH» y «Jefe Nacional de Talento
  Humano y SSO»— y a «Superusuario». Los de Gestión Humana se buscan por el
  nombre del rol y también por el del cargo (un rol de cargo con homónimos
  lleva la unidad en el nombre: «Coordinador Nacional de GGHH · …»).
  «Administrador» (TI) no los recibe: `llamados.` va en sus
  `excluir_prefijos` (`crear_roles_iniciales`), como los demás datos de
  Gestión Humana.
- **`llamados.solicitar`** a los roles de los cargos que tienen a alguien a
  cargo en el organigrama: los que tienen al menos un cargo activo que les reporta
  por la línea directa (`Cargo.jefe`) o la punteada (`Cargo.jefes_secundarios`),
  la regla de `organizacion.permisos_por_cargo.POR_TENER_EQUIPO`. Desde aquí la
  mantienen las señales del organigrama (`organizacion.senales_equipo`). Y a
  «Superusuario», que lleva todo el catálogo.

Solo suma y es idempotente. Revertirla los quita de todos los roles.
"""

from django.contrib.auth.management import create_permissions
from django.db import migrations

GESTION = ("llamados.ver", "llamados.emitir", "llamados.configurar")
SOLICITAR = "llamados.solicitar"
ROLES_GH = ("Coordinador Nacional de GGHH", "Jefe Nacional de Talento Humano y SSO")
SUPERUSUARIO = "Superusuario"


def _permisos(apps, codenames):
    Permission = apps.get_model("auth", "Permission")
    return list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codenames)
    )


def _crear_permisos(apps):
    """Los `auth.Permission` del catálogo los crea `post_migrate`, que corre
    después: se crean aquí si aún no existen (como `0040` y `0050`)."""
    configuracion = apps.get_app_config("permissions")
    antes = getattr(configuracion, "models_module", None)
    configuracion.models_module = True
    try:
        create_permissions(configuracion, apps=apps, verbosity=0)
    finally:
        configuracion.models_module = antes


def _roles_de_gestion_humana(apps) -> set[int]:
    Group = apps.get_model("auth", "Group")
    Cargo = apps.get_model("organizacion", "Cargo")
    ids = set()
    for nombre in ROLES_GH:
        ids |= set(Group.objects.filter(name__iexact=nombre).values_list("pk", flat=True))
        ids |= set(
            Cargo.objects.filter(nombre__iexact=nombre, rol__isnull=False).values_list(
                "rol_id", flat=True
            )
        )
    return ids


def _roles_con_equipo(apps) -> set[int]:
    """Los roles de los cargos a los que les reporta otro cargo activo (por
    cualquiera de las dos líneas), en todas las empresas."""
    Cargo = apps.get_model("organizacion", "Cargo")
    jefes = {
        jefe
        for cargo, jefe in Cargo.objects.filter(jefe__isnull=False, activo=True).values_list(
            "id", "jefe_id"
        )
        if jefe != cargo
    }
    Punteada = Cargo.jefes_secundarios.through
    jefes |= {
        jefe
        for cargo, jefe in Punteada.objects.filter(from_cargo__activo=True).values_list(
            "from_cargo_id", "to_cargo_id"
        )
        if jefe != cargo
    }
    return set(
        Cargo.objects.filter(pk__in=jefes, rol__isnull=False).values_list("rol_id", flat=True)
    )


def _dar(apps, permisos, rol_ids):
    Group = apps.get_model("auth", "Group")
    for rol in Group.objects.filter(pk__in=rol_ids):
        rol.permissions.add(*permisos)


def conceder(apps, schema_editor):
    _crear_permisos(apps)
    Group = apps.get_model("auth", "Group")
    superusuario = set(Group.objects.filter(name=SUPERUSUARIO).values_list("pk", flat=True))

    gestion = _permisos(apps, GESTION)
    if gestion:
        _dar(apps, gestion, _roles_de_gestion_humana(apps) | superusuario)

    solicitar = _permisos(apps, [SOLICITAR])
    if solicitar:
        _dar(apps, solicitar, _roles_con_equipo(apps) | superusuario)


def retirar(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    permisos = _permisos(apps, [*GESTION, SOLICITAR])
    for rol in Group.objects.filter(permissions__in=permisos).distinct():
        rol.permissions.remove(*permisos)


class Migration(migrations.Migration):
    dependencies = [
        ("roles", "0050_permiso_cancelar_aprobadas_propias"),
        ("permissions", "0065_permisos_de_llamados_de_atencion"),
        ("organizacion", "0049_reemplazo_en_ausencia"),
    ]

    operations = [migrations.RunPython(conceder, retirar)]
