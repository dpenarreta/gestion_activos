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
    # Cambiar el área de una persona (US-005, 11/11/2026): a quien asigna
    # cargos, porque se cambia en la misma pantalla.
    "organizacion.cambiar_area": _ESTRUCTURA,
    "institucional.perfil_cargo": _ESTRUCTURA,
    "herramientas.gestionar": _ESTRUCTURA,
    # Solicitud de permisos.
    "licencias.ver_por_aprobar": {COORDINADOR_GH, ASISTENTE_GH, ASISTENTE_ZONA_SUR},
    "licencias.ver_todas": GH_FIJOS,
    # Anular una aprobada (05/11/2026): separado de `ver_todas`, a los mismos
    # cargos que lo tenían por él.
    "licencias.anular_aprobadas": GH_FIJOS,
    "licencias.configurar": {COORDINADOR_GH, CLIMA},
    # Mis vacaciones: consultar las de otra persona.
    "vacaciones.ver_todas": {COORDINADOR_GH, ASISTENTE_GH, ASISTENTE_ZONA_SUR, CLIMA},
    # Rol de pagos: la lista de habilitados y sus códigos, el historial, los
    # textos de la consulta y las observaciones.
    "roles_pago.habilitar": GH_NOMINA,
    "roles_pago.historial": GH_NOMINA,
    "roles_pago.configurar": GH_NOMINA,
    "roles_pago.observaciones": GH_NOMINA,
    # Editar los textos de protección de datos (US-004, 11/11/2026): desde
    # entonces los términos del rol de pagos se editan ahí, así que lo llevan
    # los mismos cargos que `roles_pago.configurar` (QA-FUNC O-4). Así un
    # cargo de nómina creado después también puede editarlos.
    "privacidad.textos": GH_NOMINA,
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

#: Los que no dependen del nombre del cargo sino de su lugar en el organigrama
#: (US-013, 12/11/2026): los lleva el rol de todo cargo que **tiene a alguien a
#: cargo**, es decir, al que le reporta al menos otro cargo **activo** por la
#: línea directa (`Cargo.jefe`) o por la punteada (`Cargo.jefes_secundarios`), la
#: misma regla de equipo de `reportes.debajo` y `tasks.jerarquia.equipo_de`.
#: Solicitar un llamado de atención es para el jefe; el servidor exige además
#: que la persona sea de su equipo. Un cargo desactivado no cuenta como
#: subordinado (decisión del Tech Lead, 12/11/2026).
#:
#: Son permisos **gobernados** en los roles de cargo, como los de `REGLAS`: se
#: dan y se quitan solos cuando cambia el organigrama (al crear, editar o
#: borrar un cargo, al cambiar su jefe o sus reportes secundarios; ver
#: `senales_equipo`). Marcarlo o desmarcarlo a mano en el rol de un cargo no
#: dura: el siguiente cambio del organigrama lo devuelve a la regla. Los roles
#: que no son de cargo (Administrador, Superusuario, los personalizados) no se
#: tocan.
POR_TENER_EQUIPO = frozenset({"llamados.solicitar"})


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


def tiene_equipo(cargo) -> bool:
    """Si al cargo le reporta al menos otro cargo activo, por la línea directa o
    por la punteada."""
    if cargo is None or cargo.pk is None:
        return False
    # Sin acotar a la empresa activa: el cargo ya es de una empresa, y esto
    # también corre desde comandos y señales fuera de una petición.
    return cargo.pk in con_equipo(cargo.empresa_id, [cargo.pk])


def con_equipo(empresa_id, cargo_ids=None) -> set[int]:
    """De los cargos de la empresa (o de `cargo_ids`), los que tienen a alguien
    a cargo: un subordinado con cargo activo. Dos consultas, tenga los cargos
    que tenga."""
    from .models import Cargo

    directos = Cargo.objects.todas().filter(
        empresa_id=empresa_id, jefe_id__isnull=False, activo=True
    )
    punteados = Cargo.jefes_secundarios.through.objects.filter(
        from_cargo__empresa_id=empresa_id, from_cargo__activo=True
    )
    if cargo_ids is not None:
        directos = directos.filter(jefe_id__in=list(cargo_ids))
        punteados = punteados.filter(to_cargo_id__in=list(cargo_ids))
    jefes = {jefe for cargo, jefe in directos.values_list("id", "jefe_id") if jefe != cargo}
    jefes |= {
        jefe
        for cargo, jefe in punteados.values_list("from_cargo_id", "to_cargo_id")
        if jefe != cargo
    }
    return jefes


def sincronizar_por_equipo(empresa_id) -> int:
    """Recalcula `POR_TENER_EQUIPO` en los roles de todos los cargos de la
    empresa: lo da a los que tienen a alguien a cargo y lo quita a los que no.
    Lo llaman las señales del organigrama (`senales_equipo`), porque un cambio
    en un cargo cambia a su jefe de antes y al de ahora. Devuelve cuántos roles
    cambió. Unas pocas consultas, tenga los cargos que tenga."""
    from django.contrib.auth.models import Group, Permission
    from django.db import IntegrityError, transaction

    from .models import Cargo

    if empresa_id is None:
        return 0
    permisos = list(
        Permission.objects.filter(
            content_type__app_label="permissions", codename__in=POR_TENER_EQUIPO
        )
    )
    if not permisos:
        return 0  # antes de migrar `permissions`: no hay nada que dar
    rol_de = dict(
        Cargo.objects.todas()
        .filter(empresa_id=empresa_id, rol__isnull=False)
        .values_list("id", "rol_id")
    )
    if not rol_de:
        return 0
    jefes = con_equipo(empresa_id)
    deben = {rol for cargo, rol in rol_de.items() if cargo in jefes}
    Enlace = Group.permissions.through
    cambios = 0
    for permiso in permisos:
        tienen = set(
            Enlace.objects.filter(
                permission=permiso, group_id__in=list(rol_de.values())
            ).values_list("group_id", flat=True)
        )
        sobran = tienen - deben
        faltan = deben - tienen
        if sobran:
            Enlace.objects.filter(permission=permiso, group_id__in=list(sobran)).delete()
        if faltan:
            try:
                # Con savepoint: si otra petición lo dio a la vez, el choque
                # con la clave única no rompe la transacción de quien llama.
                with transaction.atomic():
                    Enlace.objects.bulk_create(
                        [Enlace(group_id=rol, permission=permiso) for rol in faltan]
                    )
            except IntegrityError:
                # SQL Server no admite `ignore_conflicts`: uno por uno, con
                # `add`, que salta los que ya están.
                for rol in Group.objects.filter(pk__in=faltan):
                    rol.permissions.add(permiso)
        cambios += len(sobran) + len(faltan)
    return cambios


def sincronizar_rol(rol, nombre_del_cargo: str, cargo=None) -> None:
    """Deja en el rol del cargo los permisos de la tabla que le tocan y quita
    los de la tabla que no (si el cargo se renombró). Con `cargo`, también los
    de `POR_TENER_EQUIPO`, según tenga o no a alguien a cargo. Los demás
    permisos del rol, los marcados a mano en Roles, no se tocan."""
    from django.contrib.auth.models import Permission

    debidos = permisos_del_cargo(nombre_del_cargo, rol.name)
    gobernados = set(REGLAS)
    if cargo is not None:
        gobernados |= POR_TENER_EQUIPO
        if tiene_equipo(cargo):
            debidos |= POR_TENER_EQUIPO
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
