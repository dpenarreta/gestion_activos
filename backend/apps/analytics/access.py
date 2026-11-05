"""Autorización del motor de KPI («KPI», «Mis KPI» e «Inteligencia
preventiva»).

Dos ejes, los dos resueltos en el servidor en cada petición:

1. **Permisos del catálogo** (`kpi.*`, `inteligencia_preventiva.*`),
   asignados a los roles de Gestión Humana por `analytics/0002`. Reemplazan
   los chequeos por rol de Nexo:

   - `kpi.acceder`: sus propios KPI, su Inteligencia Preventiva y el
     simulador sobre sí mismo (en Nexo, toda cuenta).
   - `kpi.equipo`: los KPI de su equipo (individuales y de equipo) y las
     alertas preventivas del equipo (en Nexo, `can_view_team`: nivel >= 2).
   - `kpi.ejecutivo`: el resumen ejecutivo del equipo (en Nexo,
     `is_leadership`: nivel >= 3).
   - `kpi.administrar`: lo que en Nexo era del ADMINISTRADOR (superusuario):
     los KPI de cualquiera de la empresa, las advertencias de validación del
     motor, el diagnóstico, la fecha de inicio del KPI y los ajustes.
   - `inteligencia_preventiva.ver`: el Índice de Riesgo Operativo y las
     recomendaciones de redistribución del equipo (en Nexo,
     `CAN_VIEW_OPERATIONAL_RISK`, el mismo nombre de permiso).

2. **Ámbito de datos**, que no es un permiso: el organigrama
   (`apps.tasks.jerarquia`, en Nexo `apps.hierarchy`). Un jefe ve a las
   personas cuyo cargo depende del suyo; quien administra, a todo el equipo
   de Gestión Humana de la empresa.

Quién es «ejecutor» se conserva de Nexo (`is_executor_group`): las vistas de
equipo excluyen al liderazgo (rol de Gestión Humana de nivel >= 4) porque sus
indicadores de ejecución no son representativos, y a quien no tiene un rol
de Gestión Humana (en Nexo, sin grupo no se es ejecutor).
"""

from django.contrib.auth import get_user_model

from apps.permissions.authorization import user_has_permission
from apps.tasks import jerarquia
from apps.tasks.roles import ALL_ROLES, ROLE_LEVEL, gh_role_of, in_active_company, role_filter

ACCEDER = "kpi.acceder"
EQUIPO = "kpi.equipo"
EJECUTIVO = "kpi.ejecutivo"
ADMINISTRAR = "kpi.administrar"
RIESGO_VER = "inteligencia_preventiva.ver"

ALL_CODENAMES = (ACCEDER, EQUIPO, EJECUTIVO, ADMINISTRAR, RIESGO_VER)

#: Nivel desde el cual un rol de Gestión Humana es «liderazgo» y no ejecuta
#: tareas operativas (`isLeadershipRole` de Nexo).
LEADERSHIP_LEVEL = 4


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def is_admin(user) -> bool:
    return can(user, ADMINISTRAR)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def is_executor(user) -> bool:
    """Réplica de `is_executor_group`: tiene un rol de Gestión Humana y su
    nivel es menor que el del liderazgo."""
    rol = gh_role_of(user)
    return bool(rol) and ROLE_LEVEL.get(rol, 0) < LEADERSHIP_LEVEL


def _gh_people_of_company():
    """Las cuentas activas de la empresa activa con algún rol de Gestión
    Humana (lo que en Nexo veía el ADMINISTRADOR)."""
    User = get_user_model()
    return (
        User.objects.filter(is_active=True)
        .filter(in_active_company())
        .filter(role_filter(ALL_ROLES))
        .distinct()
    )


def team_members(actor) -> list:
    """Su equipo para el motor (en Nexo, `get_team_members`: los roles
    subordinados visibles): quien administra, todo el equipo de Gestión
    Humana de la empresa; el resto, las personas de su equipo según el
    organigrama. Siempre con un rol de Gestión Humana y sin la propia
    persona."""
    if is_admin(actor):
        # Como en Nexo, sin quienes tienen su mismo rol (`get_subordinate_groups`
        # excluía el grupo propio).
        propio = gh_role_of(actor)
        candidatos = [
            persona
            for persona in _gh_people_of_company().exclude(pk=actor.pk)
            if not propio or gh_role_of(persona) != propio
        ]
    else:
        candidatos = list(jerarquia.equipo_de(actor, solo_activos=True))
    return [persona for persona in candidatos if gh_role_of(persona)]


def executor_members(actor) -> list:
    """Su equipo EJECUTOR (en Nexo, `get_subordinate_executor_groups`),
    ordenado por nombre como en Nexo."""
    miembros = [persona for persona in team_members(actor) if is_executor(persona)]
    return sorted(miembros, key=lambda m: m.first_name or m.username)


def peers_same_cargo(user) -> list:
    """Las personas activas de la empresa que ocupan su mismo cargo del
    organigrama, sin ella (para el Benchmark Inteligente: en Nexo, quienes
    tenían su mismo rol). Sin cargo, ninguna."""
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    cargo = jerarquia.cargo_de(user)
    if cargo is None or empresa is None or empresa is SIN_EMPRESA:
        return []
    User = get_user_model()
    return list(
        User.objects.filter(
            is_active=True,
            datos_de_contacto__empresa=empresa,
            datos_de_contacto__cargo=cargo,
            membresias__empresa=empresa,
        )
        .exclude(pk=user.pk)
        .distinct()
        .order_by("pk")
    )


def can_view_target(actor, target) -> bool:
    """Si `actor` puede consultar los KPI de `target` (en Nexo,
    `_can_view_target_user`: propio, superusuario o visible por jerarquía).
    `target` ya es de la empresa activa (lo resuelve la vista)."""
    if actor is None or target is None:
        return False
    if actor.pk == target.pk:
        return True
    if is_admin(actor):
        return True
    return can(actor, EQUIPO) and target.pk in jerarquia.equipo_ids(actor)


def leave_detail_visible(actor, target) -> bool:
    """Si ve el motivo de las ausencias de `target` (LOPDP)."""
    from apps.ausencias.access import can_see_leave_detail

    return can_see_leave_detail(actor, target.pk)


def special_status_visible(actor, target) -> bool:
    """Si ve el tipo de estado especial de `target` (LOPDP)."""
    from apps.ausencias.access import can_see_special_status

    return can_see_special_status(actor, target.pk)
