"""Los roles del equipo de Gestión Humana que usa Tareas.

Son los mismos de Nexo (`src/lib/roles.ts`), ya creados en la intranet por la
migración `novedades/0004_roles_de_gestion_humana`. En Nexo el «Administrador»
era el superusuario; aquí es el rol «Administrador de Gestión Humana»
(`novedades/0003`), que no da nada fuera del módulo.

Un rol vale global (`user.groups`) o por la membresía en la empresa activa
(`MembresiaEmpresa.roles`), igual que en el resto de la intranet. En Nexo cada
persona tenía un solo rol; aquí puede tener varios, así que «su rol» en
Gestión Humana es el de mayor nivel (`ROLE_LEVEL`) y, a igual nivel, el
primero de `ALL_ROLES`.
"""

from django.db.models import Q

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual

ADMIN_GH = "Administrador de Gestión Humana"

JEFE_NACIONAL = "JEFE_NACIONAL"
COORDINADOR_NACIONAL = "COORDINADOR_NACIONAL"
COORDINADOR_ZS = "COORDINADOR_ZS"
ANALISTA_CC = "ANALISTA_CC"
ANALISTA_SELECCION = "ANALISTA_SELECCION"
ASISTENTE_SELECCION = "ASISTENTE_SELECCION"
ASISTENTE_GH = "ASISTENTE_GH"
ASISTENTE_GH_ZS = "ASISTENTE_GH_ZS"
TRABAJO_SOCIAL = "TRABAJO_SOCIAL"
ASISTENTE_NOMINA = "ASISTENTE_NOMINA"

#: Nivel de cada rol (`ROLE_LEVEL` de Nexo). En Tareas y Equipo solo decide
#: cuál es «el» rol de quien tiene varios; los permisos salen del catálogo.
ROLE_LEVEL: dict[str, int] = {
    ADMIN_GH: 5,
    JEFE_NACIONAL: 4,
    COORDINADOR_NACIONAL: 3,
    COORDINADOR_ZS: 2,
    ANALISTA_CC: 2,
    ANALISTA_SELECCION: 2,
    ASISTENTE_SELECCION: 1,
    ASISTENTE_GH: 1,
    ASISTENTE_GH_ZS: 1,
    TRABAJO_SOCIAL: 1,
    ASISTENTE_NOMINA: 1,
}

#: Nombre legible de cada rol (`ROLE_LABEL` de Nexo).
ROLE_LABEL: dict[str, str] = {
    ADMIN_GH: "Administrador de Gestión Humana",
    JEFE_NACIONAL: "Jefe Nacional",
    COORDINADOR_NACIONAL: "Coordinador Nacional",
    COORDINADOR_ZS: "Coordinador ZS",
    ANALISTA_CC: "Analista Clima y Cultura",
    ANALISTA_SELECCION: "Analista Selección de Personal",
    ASISTENTE_SELECCION: "Asistente de Selección",
    ASISTENTE_GH: "Asistente de Gestión Humana",
    ASISTENTE_GH_ZS: "Asistente GH ZS",
    TRABAJO_SOCIAL: "Trabajo Social",
    ASISTENTE_NOMINA: "Asistente de Nómina",
}

#: Los roles que pueden ir en un motivo de actividad o en las reglas de aviso
#: (`ALL_ROLES` de Nexo, con el Administrador de la intranet).
ALL_ROLES: list[str] = list(ROLE_LABEL.keys())

#: Los diez roles del departamento (sin el Administrador).
TEAM_ROLES: list[str] = [rol for rol in ALL_ROLES if rol != ADMIN_GH]


def role_names_of(user) -> set[str]:
    """Todos los roles de la persona: los globales y los de su membresía en la
    empresa activa. Fuera de una petición (comandos) solo los globales."""
    if user is None or not getattr(user, "is_authenticated", False):
        return set()
    names = set(user.groups.values_list("name", flat=True))
    empresa = empresa_actual()
    if empresa is not None and empresa is not SIN_EMPRESA:
        names |= set(user.membresias.filter(empresa=empresa).values_list("roles__name", flat=True))
    names.discard(None)
    return names


def gh_roles_of(user) -> list[str]:
    """Sus roles de Gestión Humana, del de mayor nivel al de menor."""
    propios = role_names_of(user)
    return sorted(
        (rol for rol in ALL_ROLES if rol in propios),
        key=lambda rol: (-ROLE_LEVEL[rol], ALL_ROLES.index(rol)),
    )


def gh_role_of(user) -> str:
    """«Su» rol en Gestión Humana, o cadena vacía si no tiene ninguno."""
    roles = gh_roles_of(user)
    return roles[0] if roles else ""


def role_label(role: str) -> str:
    return ROLE_LABEL.get(role, role)


def role_filter(role_names, prefix: str = "") -> Q:
    """Filtro de usuarios con alguno de los roles, global o por su membresía
    en la empresa activa (sin empresa activa, en cualquiera)."""
    names = list(role_names)
    condition = Q(**{f"{prefix}groups__name__in": names})
    empresa = empresa_actual()
    if empresa is SIN_EMPRESA:
        return condition
    membership = Q(**{f"{prefix}membresias__roles__name__in": names})
    if empresa is not None:
        membership &= Q(**{f"{prefix}membresias__empresa": empresa})
    return condition | membership


def in_active_company(prefix: str = "") -> Q:
    """Filtro de las cuentas que trabajan en la empresa activa (o todas, sin
    petición)."""
    empresa = empresa_actual()
    if empresa is None:
        return Q()
    if empresa is SIN_EMPRESA:
        return Q(pk__in=[])
    return Q(**{f"{prefix}membresias__empresa": empresa})
