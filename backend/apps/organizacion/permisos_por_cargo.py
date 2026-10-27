"""Los permisos del módulo Institucional que da cada cargo (22/10/2026).

Lo pidió Gestión Humana en «PERMISOS – MÓDULO INSTITUCIONAL»: quién gestiona
noticias, el calendario, la estructura, los flujos, las vacaciones de otros…
se decide por el **cargo** de la persona, no por un rol asignado a mano. Como
cada cargo es un rol (`roles_de_cargo`), aquí se dice qué permisos lleva el
rol de cada cargo; se aplican al crearlo y al renombrarlo, y la migración los
aplicó a los que ya existían. Los cargos se comparan por nombre, sin
distinguir mayúsculas ni tildes. Cuando hay homónimos y el permiso es solo
para uno, la regla lleva el nombre completo de su rol («Asistente de Gestión
Humana · Gestión Humana y Seguridad Ocupacional · Coordinador Nacional de
Gestión Humana»): vale para ese rol y no para los demás que se llaman igual.

Administrador y Superusuario (los `ADMINS` del pedido) ya tienen todo el
catálogo. La excepción es consultar el propio rol de pagos: no va por rol ni
por cargo sino por una lista de personas habilitadas (`roles_pago.consultar`,
asignado persona por persona; ver `apps.nomina.services`).
"""

import unicodedata

# Los cargos de Gestión Humana con los nombres del organigrama GGHH 2026
# (23/10/2026). Cada uno es el cargo de antes, renombrado, y conserva lo que
# tenía: Desarrollo y Capacitación de Personal era «Analista de Clima y
# Cultura»; el Coordinador Nacional de GGHH, el «Coordinador Nacional de
# Gestión Humana»; el Jefe de GGH y SSO, el «Jefe de Gestión Humana y
# Seguridad Ocupacional»; el Asistente de GGHH y el Asistente Zona Sur, los dos
# «Asistente de Gestión Humana» (el del Coordinador Nacional y el del
# Coordinador de Gestión Humana, hoy Coordinador Zona Sur).
#
# Con el organigrama «Gestión de Talento Humano LCE 2026» (27/10/2026,
# `talento_humano_2026.py`) se renombraron otra vez, con lo mismo: Desarrollo y
# Capacitación de Personal es el Analista Clima y Cultura; el Jefe de GGH y SSO,
# el Jefe Nacional de Talento Humano y SSO; el Asistente Zona Sur, el Asistente
# Gestión Humana Zona Sur.
CLIMA = "Analista Clima y Cultura"
COORDINADOR_GH = "Coordinador Nacional de GGHH"
JEFE_GH = "Jefe Nacional de Talento Humano y SSO"
ASISTENTE_GH = "Asistente de GGHH"
ASISTENTE_ZONA_SUR = "Asistente Gestión Humana Zona Sur"
ASISTENTE_NOMINA = "Asistente de Nómina"

#: Gestión Humana: todo su personal.
GH_FIJOS = {COORDINADOR_GH, JEFE_GH, CLIMA, ASISTENTE_GH, ASISTENTE_ZONA_SUR, ASISTENTE_NOMINA}
#: Gestión Humana: quienes llevan la nómina.
GH_NOMINA = {COORDINADOR_GH, ASISTENTE_GH, ASISTENTE_ZONA_SUR, ASISTENTE_NOMINA}
#: Tecnología: quienes también arman la estructura del organigrama.
TI_ESTRUCTURA = {"Coordinador TI", "Coordinador de Soporte Técnico", "Jefe TI"}

_ESTRUCTURA = {CLIMA, COORDINADOR_GH, JEFE_GH} | TI_ESTRUCTURA

#: Descarga masiva de roles de pagos (22/10/2026): de los dos asistentes de
#: Gestión Humana, solo el que reportaba al Coordinador Nacional (hoy
#: Asistente de GGHH).
DESCARGA_MASIVA = {COORDINADOR_GH, ASISTENTE_GH, ASISTENTE_NOMINA}

#: Permiso → cargos que lo llevan.
REGLAS: dict[str, set[str]] = {
    # Gestionar noticias (carrusel de Inicio).
    "noticias.gestionar": {CLIMA},
    # Gestionar el calendario de Inicio.
    "calendario.gestionar": {CLIMA, COORDINADOR_GH, JEFE_GH},
    # Editar estructura: acceso total a «Estructura del organigrama» (y, con
    # ello, el organigrama de todas las áreas).
    "institucional.editar": _ESTRUCTURA,
    "institucional.asignar": _ESTRUCTURA,
    "institucional.perfil_cargo": _ESTRUCTURA,
    "herramientas.gestionar": _ESTRUCTURA,
    # Solicitud de permisos.
    "licencias.ver_por_aprobar": {COORDINADOR_GH, ASISTENTE_GH, ASISTENTE_ZONA_SUR},
    "licencias.ver_todas": GH_FIJOS,
    "licencias.configurar": {COORDINADOR_GH, CLIMA},
    # Mis vacaciones: consultar las de otra persona.
    "vacaciones.ver_todas": {COORDINADOR_GH, ASISTENTE_GH, ASISTENTE_ZONA_SUR, CLIMA},
    # Rol de pagos: la lista de habilitados y sus códigos, el historial, los
    # textos de la consulta y las observaciones.
    "roles_pago.habilitar": GH_NOMINA,
    "roles_pago.historial": GH_NOMINA,
    "roles_pago.configurar": GH_NOMINA,
    "roles_pago.observaciones": GH_NOMINA,
    # Descarga masiva por área (22/10/2026): un ZIP con un PDF por persona.
    "roles_pago.descarga_masiva": DESCARGA_MASIVA,
    # Roles sin abrir (26/10/2026): todo Gestión Humana, para acercarse a
    # quienes no han abierto su rol de pagos.
    "roles_pago.seguimiento": GH_FIJOS,
    # Códigos de conducta: gestionar los documentos.
    "codigos.publicar": {CLIMA},
}

#: Los que no se dan por rol: solo persona por persona.
SOLO_POR_PERSONA = {"roles_pago.consultar"}


def normalizar(nombre: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", (nombre or "").strip().lower())
        if unicodedata.category(c) != "Mn"
    )


_POR_CARGO: dict[str, set[str]] = {}
for _codename, _cargos in REGLAS.items():
    for _cargo in _cargos:
        _POR_CARGO.setdefault(normalizar(_cargo), set()).add(_codename)


def permisos_del_cargo(nombre: str, nombre_del_rol: str = "") -> set[str]:
    """Los permisos de la tabla que lleva un cargo con ese nombre (y los de
    las reglas escritas con el nombre completo de su rol)."""
    debidos = set(_POR_CARGO.get(normalizar(nombre), set()))
    if nombre_del_rol:
        debidos |= _POR_CARGO.get(normalizar(nombre_del_rol), set())
    return debidos


def sincronizar_rol(rol, nombre_del_cargo: str) -> None:
    """Deja en el rol del cargo los permisos de la tabla que le tocan y quita
    los de la tabla que no (si el cargo se renombró). Los demás permisos del
    rol, los marcados a mano en Roles, no se tocan."""
    from django.contrib.auth.models import Permission

    debidos = permisos_del_cargo(nombre_del_cargo, rol.name)
    gobernados = set(REGLAS)
    actuales = set(
        rol.permissions.filter(codename__in=gobernados).values_list("codename", flat=True)
    )
    sobran = actuales - debidos
    faltan = debidos - actuales
    tipo = {"content_type__app_label": "permissions"}
    if sobran:
        rol.permissions.remove(*Permission.objects.filter(codename__in=sobran, **tipo))
    if faltan:
        rol.permissions.add(*Permission.objects.filter(codename__in=faltan, **tipo))
