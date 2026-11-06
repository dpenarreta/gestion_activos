"""Quién genera y quién ve los informes ejecutivos, y sobre quiénes.

Dos ejes, como el resto de Gestión Humana, resueltos en el servidor en cada
petición:

1. **Permisos del catálogo** (`informes_gh.*`, asignados por `informes/0002`).
   En Nexo había uno solo, `reportes.ver` («ver y generar», del Jefe Nacional,
   el Coordinador Nacional y el ADMINISTRADOR); aquí se separan:

   - `informes_gh.ver`: el historial de informes de su ámbito, abrirlos y
     descargarlos en Excel.
   - `informes_gh.generar`: emitir informes nuevos sobre su equipo.
   - `informes_gh.administrar`: alcance completo (lo que en Nexo era el
     ADMINISTRADOR): generar sobre toda la empresa, ver todos los informes,
     su bitácora y los incidentes de integridad. `kpi.administrar` también da
     el alcance completo: quien ya ve los KPI de cualquiera de la empresa no
     necesita otro permiso para resumirlos.

2. **Ámbito de datos**, que no es un permiso: el organigrama
   (`apps.tasks.jerarquia`). En Nexo el roster salía de la tabla rol → rol
   (`get_visible_groups`); aquí, del equipo de la persona según su cargo.

**`scope`** (JEFE / COORDINADOR), el campo de Nexo que decidía quién veía qué
informe, se conserva y se deriva así: JEFE si quien genera tiene alcance
completo (toda la empresa), COORDINADOR si genera sobre su equipo. Ya no
decide la visibilidad: un informe se ve si se tiene alcance completo, si uno lo
generó o si uno ve (por el organigrama) a TODAS las personas que incluye. Es la
regla de «ver un informe es ver a quienes salen en él».
"""

from django.contrib.auth import get_user_model

from apps.analytics import access as kpi_access
from apps.organizacion.models import DatosDeContacto
from apps.permissions.authorization import user_has_permission
from apps.tasks import jerarquia
from apps.tasks.roles import ALL_ROLES, gh_role_of, in_active_company, role_filter

from .models import ExecutiveReportSnapshot

VER = "informes_gh.ver"
GENERAR = "informes_gh.generar"
ADMINISTRAR = "informes_gh.administrar"

ALL_CODENAMES = (VER, GENERAR, ADMINISTRAR)

User = get_user_model()


def can(user, codename: str) -> bool:
    return user_has_permission(user, codename)


def alcance_completo(user) -> bool:
    """Toda la empresa: `informes_gh.administrar` o `kpi.administrar`."""
    return can(user, ADMINISTRAR) or can(user, kpi_access.ADMINISTRAR)


def effective_codenames(user) -> list[str]:
    return [codename for codename in ALL_CODENAMES if can(user, codename)]


def scope_de(user) -> str:
    scope = (
        ExecutiveReportSnapshot.Scope.JEFE
        if alcance_completo(user)
        else ExecutiveReportSnapshot.Scope.COORDINADOR
    )
    return scope.value


# ── Roster ──────────────────────────────────────────────────────────────────


def _candidatos(actor) -> list:
    """Las personas sobre las que `actor` puede generar: con alcance completo,
    las cuentas activas de la empresa con un rol de Gestión Humana; si no, su
    equipo según el organigrama. Siempre sin la propia persona y solo
    «ejecutores» (sin el liderazgo, nivel >= 4, ni quien no tiene rol de
    Gestión Humana), como `get_visible_groups` + `is_executor_group` de
    Nexo: los indicadores de ejecución del liderazgo no son representativos."""
    if alcance_completo(actor):
        base = (
            User.objects.filter(is_active=True)
            .filter(in_active_company())
            .filter(role_filter(ALL_ROLES))
            .exclude(pk=actor.pk)
            .distinct()
        )
    else:
        base = jerarquia.equipo_de(actor, solo_activos=True)
    return [persona for persona in base if kpi_access.is_executor(persona)]


def _unidades(personas) -> dict[int, dict]:
    """La unidad del organigrama (el «área») del cargo de cada persona en la
    empresa activa."""
    from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

    empresa = empresa_actual()
    if empresa is None or empresa is SIN_EMPRESA or not personas:
        return {}
    filas = (
        DatosDeContacto.objects.todas()
        .filter(empresa=empresa, usuario_id__in=[p.pk for p in personas], cargo__isnull=False)
        .values_list("usuario_id", "cargo__nombre", "cargo__unidad_id", "cargo__unidad__nombre")
    )
    return {
        usuario_id: {"cargo": cargo, "unidad_id": unidad_id, "unidad": unidad}
        for usuario_id, cargo, unidad_id, unidad in filas
    }


def resolver_roster(actor, *, roles=(), areas=(), colaboradores=()) -> dict:
    """El roster de un informe (réplica de `RosterView`/`resolveRoster.ts`).

    Los filtros solo ACOTAN lo que el organigrama ya permite, nunca lo amplían:
    - `roles`: roles de Gestión Humana (los códigos de Nexo, p. ej.
      `ANALISTA_CC`).
    - `areas`: ids de unidades del organigrama. En Nexo «área» era un alias
      de `roles` porque Nexo no tenía esa dimensión; la intranet sí la tiene
      (la unidad del cargo de cada persona) y el filtro la usa.
    - `colaboradores`: ids de cuentas.

    `roster_kind`: INDIVIDUAL con un colaborador pedido, POR_AREA con varios o
    con filtro de rol o área, CONSOLIDADO sin filtros (como en Nexo)."""
    personas = _candidatos(actor)
    unidades = _unidades(personas)
    roles = {str(r) for r in roles if str(r).strip()}
    areas = {int(a) for a in areas}
    colaboradores = {int(c) for c in colaboradores}

    if roles:
        personas = [p for p in personas if gh_role_of(p) in roles]
    if areas:
        personas = [p for p in personas if (unidades.get(p.pk) or {}).get("unidad_id") in areas]
    if colaboradores:
        personas = [p for p in personas if p.pk in colaboradores]

    personas.sort(key=lambda p: ((p.first_name or p.username).lower(), p.pk))
    users = [
        {
            "id": p.pk,
            "name": p.first_name or p.username,
            "full_name": p.get_full_name() or p.username,
            "role": gh_role_of(p),
            "cargo": (unidades.get(p.pk) or {}).get("cargo"),
            "unidad_id": (unidades.get(p.pk) or {}).get("unidad_id"),
            "unidad": (unidades.get(p.pk) or {}).get("unidad"),
        }
        for p in personas
    ]

    if colaboradores:
        roster_kind = "INDIVIDUAL" if len(colaboradores) == 1 else "POR_AREA"
    elif roles or areas:
        roster_kind = "POR_AREA"
    else:
        roster_kind = "CONSOLIDADO"

    return {
        "users": users,
        "user_ids": [u["id"] for u in users],
        "scope": scope_de(actor),
        "roster_kind": roster_kind,
    }


# ── Visibilidad de un informe ───────────────────────────────────────────────


def visibles_para(viewer):
    """Una función `(generated_by_id, collaborator_ids) -> bool` con el equipo
    de `viewer` ya resuelto, para filtrar listados sin una consulta por fila."""
    if alcance_completo(viewer):
        return lambda _autor, _ids: True
    propios = jerarquia.equipo_ids(viewer) | {viewer.pk}

    def puede(autor_id, ids) -> bool:
        if autor_id == viewer.pk:
            return True
        ids = list(ids or [])
        # Un informe sin colaboradores solo lo ve quien lo generó (o el alcance
        # completo): no hay a quién «ver» en él. Un id que no es un entero (un
        # «nexo:<id>» sin cuenta) nunca está en el equipo.
        return bool(ids) and all(isinstance(i, int) and i in propios for i in ids)

    return puede


def puede_ver_informe(viewer, snapshot: ExecutiveReportSnapshot) -> bool:
    return visibles_para(viewer)(snapshot.generated_by_id, snapshot.collaborator_ids)
