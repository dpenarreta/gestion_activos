"""El organigrama del departamento Financiero Administrativo (09/11/2026).

Lo pasó el usuario en el SmartArt de un Excel:

    Jefe Financiero Administrativo (Christian Coque) · jefe: Gerente General
    ├ Contabilidad: Coordinador de Contabilidad (Teresa Pozo)
    │ └ Asistente de Contabilidad (5)
    ├ Administración
    │ ├ Asistente Administrativo Quito (Daniela Albán)
    │ │ └ Asistente Administrativo 2, Mensajero, Servicios Generales y
    │ │   Recepcionista de Quito
    │ ├ Administrador Guayaquil (Rafael Villafuerte)
    │ │ └ Asistente Administrativo, Asistente Administrativo 2, Mensajero y
    │ │   Servicios Generales (2) de Guayaquil
    │ └ Administrador Cuenca (Nube Quizhpi)
    ├ Cartera: Jefe de Cartera · jefe: Gerente General
    │ ├ Coordinador de Cartera Zona Sur
    │ │ └ Telecobrador Guayaquil (2) y Recaudador Guayaquil
    │ └ Asistente de Cartera
    │   └ Telecobrador Quito (2), Contados, COD (2) y Recaudador Quito
    ├ Facturación: Jefe › Coordinador › Asistente de Facturación Guayaquil
    ├ Nómina: Jefe de Nómina › Asistente de Nómina
    ├ Siniestros: Jefe de Siniestros › Asistente de Siniestros (3, una vacante)
    ├ Bodega: Jefe de Bodega
    ├ Transporte: Jefe de Transporte › Asistente de Transporte (2)
    └ Gestión de Talento Humano (su estructura no cambia)

Decisiones del usuario y del levantamiento:

- Cada bloque es un área bajo Financiero Administrativo, en el nivel de las
  áreas de un departamento (el de Facturación). Las sedes de Administración no
  son unidades: van en el nombre del cargo, como en `comercial_2026` y
  `ups_2026`.
- En el dibujo había cadenas (Asistente 2 → Mensajería → Servicios Generales
  → Recepción); no son jerarquía: todos reportan al jefe del bloque. Lo mismo
  bajo la Asistente de Cartera.
- «Ecuacopia», en el bloque de Quito, es un proveedor externo: no es cargo ni
  persona y no se carga.
- Cartera cuelga de Financiero Administrativo, pero su Jefatura reporta al
  Gerente General. El cargo tiene un solo jefe (no hay reporte funcional o
  secundario en el modelo), así que la relación con el Jefe Financiero queda
  solo en la unidad. Sus cargos de `cartera_2026` se renombran (conservan su
  rol): el Coordinador pasa a Coordinador de Cartera Zona Sur, la Asistente de
  Tesorería a Asistente de Cartera, las tres asistentes del Jefe a COD y los
  telecobradores y recaudadores llevan su ciudad; la Asistente de Cartera del
  Coordinador queda sin nadie y se desactiva.
- Talento Humano pasa a colgar de Financiero Administrativo. Su Gerente sigue
  reportando al Gerente General (`JEFE_DE_TALENTO_HUMANO`): es regla del
  usuario que el gerente de un área reporte al Gerente General, y una Gerencia
  de Área no puede reportar a una Jefatura (`niveles_cargo.validar_jefe`).
  El Jefe y la Asistente de Nómina salen de ahí al área Nómina, con su rol y
  quienes los ocupan.
- Los cargos que ya estaban en Financiero Administrativo pasan a su área si
  son el mismo puesto (Contabilidad, Siniestros —el Coordinador pasa a Jefe—,
  y el Asistente Administrativo, que es el de Quito); el Auxiliar de
  Facturación pasa a Asistente de Facturación Guayaquil. Los dudosos
  (Coordinador Logístico y Asistente de Logística, que podían ser Bodega o
  Transporte; Coordinador Administrativo, Mensajero y Servicios Generales, sin
  sede) se desactivan si nadie los ocupa.
- Un cargo no queda por encima del nivel de su jefe (los telecobradores que
  reportan a la Asistente de Cartera quedan como Asistente de área), como
  hace `niveles_cargo.sugerido` con los cargos nuevos.
- Los nombres de las personas que ya estaban se dejan como estaban, para no
  duplicarlas: «Elsi Maldonado» (el Excel dice «Elsy») y «Willian Estuardo
  Sánchez Murillo» (el Excel dice «William»). «Jennifer Bailón» lo confirmó el
  usuario (el Excel dice «Baylo»).

Lo aplica la migración 0044 y deja el cambio en la bitácora del organigrama.
Repetirlo no cambia nada.
"""

from . import departamentos_del_organigrama, niveles_cargo, roles_de_cargo, versiones
from .levantamientos import _unidad, levantar
from .models import Cargo, NivelJerarquico, UnidadOrganizacional
from .permisos_por_cargo import normalizar as _normal

UNIDAD = "Financiero Administrativo"
PADRE = "Gerencia General"
JEFE = "Jefe Financiero Administrativo"
#: El jefe del cargo más alto de Talento Humano (ver el docstring).
JEFE_DE_TALENTO_HUMANO = "Gerente General"
TALENTO_HUMANO = "Gestión de Talento Humano"

MOTIVO = (
    "Organigrama del departamento Financiero Administrativo enviado por el "
    "usuario: Contabilidad, Administración (Quito, Guayaquil y Cuenca), "
    "Cartera, Facturación, Nómina, Siniestros, Bodega, Transporte y Talento "
    "Humano como áreas del departamento, con las personas de cada cargo."
)


def _cargo(nombre, jefe, plazas=1, antes=(), personas=()):
    return {
        "nombre": nombre,
        "jefe": jefe,
        "plazas": plazas,
        "antes": list(antes),
        "personas": list(personas),
    }


#: Ver `laarbox_2026.CARGOS`.
CARGOS = {
    "jefe": _cargo(
        "Jefe Financiero Administrativo", "Gerente General", 1, [], [("Christian", "Coque")]
    )
}

#: Las áreas del departamento, en orden: nombre → cargos. Los «antes» son
#: (nombre del cargo, nombre de su jefe) como estaban.
AREAS = {
    "Contabilidad": {
        "coordinador": _cargo("Coordinador de Contabilidad", JEFE, 1, [], [("Teresa", "Pozo")]),
        "asistente": _cargo(
            "Asistente de Contabilidad",
            "coordinador",
            5,
            [],
            [
                ("Dario", "Reyes"),
                ("Evelyn", "Alcivar"),
                ("Cristina", "Ortega"),
                ("Nohemí", "Pomaquero"),
                ("Britany", "Peralta"),
            ],
        ),
    },
    "Administración": {
        # Quito
        "asistente_uio": _cargo(
            "Asistente Administrativo Quito",
            JEFE,
            1,
            [("Asistente Administrativo", JEFE)],
            [("Daniela", "Albán")],
        ),
        "asistente2_uio": _cargo(
            "Asistente Administrativo 2 Quito", "asistente_uio", 1, [], [("Andrés", "Lima")]
        ),
        "mensajero_uio": _cargo("Mensajero Quito", "asistente_uio", 1, [], [("Geovany", "Rivera")]),
        "servicios_uio": _cargo(
            "Servicios Generales Quito", "asistente_uio", 1, [], [("Norma", "Coquinche")]
        ),
        "recepcion_uio": _cargo(
            "Recepcionista Quito", "asistente_uio", 1, [], [("Erika", "Albuquerque")]
        ),
        # Guayaquil
        "administrador_gye": _cargo(
            "Administrador Guayaquil", JEFE, 1, [], [("Rafael", "Villafuerte")]
        ),
        "asistente_gye": _cargo(
            "Asistente Administrativo Guayaquil",
            "administrador_gye",
            1,
            [],
            [("Jessica", "Murillo")],
        ),
        "asistente2_gye": _cargo(
            "Asistente Administrativo 2 Guayaquil", "administrador_gye", 1, [], [("Alan", "Lazo")]
        ),
        "mensajero_gye": _cargo(
            "Mensajero Guayaquil", "administrador_gye", 1, [], [("Colón", "Parrales")]
        ),
        "servicios_gye": _cargo(
            "Servicios Generales Guayaquil",
            "administrador_gye",
            2,
            [],
            [("Javier", "Solis"), ("Israel", "Suarez")],
        ),
        # Cuenca
        "administrador_cue": _cargo("Administrador Cuenca", JEFE, 1, [], [("Nube", "Quizhpi")]),
    },
    # Las personas, con el nombre completo con que las cargó `cartera_2026`.
    # El orden importa: quien recibe a una persona va antes que quien la pierde
    # (Contados antes que COD), así las plazas quedan bien a la primera; y COD
    # reconoce a las asistentes del Jefe antes de que la Asistente de Cartera
    # busque su nombre.
    "Cartera": {
        "jefe": _cargo(
            "Jefe de Cartera",
            "Gerente General",
            1,
            [("Jefe de Cartera", JEFE)],
            [("Sara Fernanda", "Marroquín García")],
        ),
        "coordinador": _cargo(
            "Coordinador de Cartera Zona Sur",
            "jefe",
            1,
            [("Coordinador de Cartera", "Jefe de Cartera")],
            [("Margarita Cecilia", "Vélez Caicedo")],
        ),
        "telecobrador_gye": _cargo(
            "Telecobrador Guayaquil",
            "coordinador",
            2,
            [("Telecobrador", "Coordinador de Cartera")],
            [("Cindy Carolina", "Valdez Muñoz"), ("Irene Yesenia", "Sarcos Maruri")],
        ),
        "recaudador_gye": _cargo(
            "Recaudador Guayaquil",
            "coordinador",
            1,
            [("Recaudador", "Coordinador de Cartera")],
            [("Miguel Ángel", "Pincay Arroyo")],
        ),
        "contados": _cargo("Contados", "asistente", 1, [], [("Lizbeth Rocío", "Gualotuña Haro")]),
        "cod": _cargo(
            "COD",
            "asistente",
            2,
            [("Asistente de Cartera", "Jefe de Cartera")],
            [("Jennifer", "Bailón"), ("Lorena Elizabeth", "Espinosa Tituaña")],
        ),
        "asistente": _cargo(
            "Asistente de Cartera",
            "jefe",
            1,
            [("Asistente de Tesorería", "Jefe de Cartera")],
            [("Daniela Lorena", "Marroquín García")],
        ),
        "telecobrador_uio": _cargo(
            "Telecobrador Quito",
            "asistente",
            2,
            [("Telecobrador", "Jefe de Cartera")],
            [("Cindy Violeta", "Acosta Gualpa"), ("Belén", "Cuichán")],
        ),
        "recaudador_uio": _cargo(
            "Recaudador Quito",
            "asistente",
            1,
            [("Recaudador", "Jefe de Cartera")],
            [("Willian Estuardo", "Sánchez Murillo")],
        ),
    },
    "Facturación": {
        "jefe": _cargo("Jefe de Facturación", JEFE, 1, [], [("Giovanny", "Vera")]),
        "coordinador": _cargo(
            "Coordinador de Facturación", "jefe", 1, [], [("Ricardo", "Salinas")]
        ),
        "asistente": _cargo(
            "Asistente de Facturación Guayaquil",
            "coordinador",
            1,
            [("Auxiliar de Facturación", "Coordinador de Facturación")],
            [("Manuel", "Guaigua")],
        ),
    },
    "Nómina": {
        "jefe": _cargo(
            "Jefe de Nómina",
            JEFE,
            1,
            [
                ("Jefe de Nómina", "Jefe Nacional de Talento Humano y SSO"),
                ("Jefe de Nómina", "Coordinador Nacional de GGHH"),
            ],
            [("Elsi", "Maldonado")],
        ),
        "asistente": _cargo(
            "Asistente de Nómina", "jefe", 1, [], [("Madelyn Cristina", "Hurtado Montalvo")]
        ),
    },
    "Siniestros": {
        "jefe": _cargo(
            "Jefe de Siniestros",
            JEFE,
            1,
            [("Coordinador de Siniestros", JEFE)],
            [("Andrés", "Celleri")],
        ),
        # Tres plazas: la tercera («NN» en el Excel) está vacante.
        "asistente": _cargo(
            "Asistente de Siniestros",
            "jefe",
            3,
            [("Asistente de Siniestros", "Coordinador de Siniestros")],
            [("Daniel", "Silva"), ("Esteban", "Minda")],
        ),
    },
    "Bodega": {
        "jefe": _cargo("Jefe de Bodega", JEFE, 1, [], [("Christian", "Castro")]),
    },
    "Transporte": {
        "jefe": _cargo("Jefe de Transporte", JEFE, 1, [], [("Shirley", "Rosales")]),
        "asistente": _cargo(
            "Asistente de Transporte",
            "jefe",
            2,
            [],
            [("Javier", "Molina"), ("Jessica", "de la Torre")],
        ),
    },
}

#: Cargos que pasan de otra unidad a un área del departamento antes de
#: levantarla: área → (unidad de donde salen, nombres de los cargos).
TRASLADOS = {
    "Contabilidad": (UNIDAD, ("Coordinador de Contabilidad", "Asistente de Contabilidad")),
    "Administración": (UNIDAD, ("Asistente Administrativo",)),
    "Siniestros": (UNIDAD, ("Coordinador de Siniestros", "Asistente de Siniestros")),
    "Nómina": (TALENTO_HUMANO, ("Jefe de Nómina", "Asistente de Nómina")),
}

#: Las áreas del departamento, en el orden en que se muestran.
ORDEN = (*AREAS, TALENTO_HUMANO)


def aplicar() -> list[str]:
    """Deja el departamento como dice el organigrama en la empresa activa y lo
    anota en la bitácora. Devuelve lo que cambió (vacío si ya estaba así)."""
    with versiones.sin_peticion(MOTIVO) as resultado:
        cambiar()
    return resultado["lineas"]


def _buscar(nombre):
    return next(
        (
            u
            for u in UnidadOrganizacional.objects.select_related("nivel")
            if _normal(u.nombre) == _normal(nombre)
        ),
        None,
    )


def _nivel_de_area(departamento):
    """El nivel de las áreas de un departamento: el siguiente al suyo."""
    return (
        NivelJerarquico.objects.filter(orden__gt=departamento.nivel.orden).order_by("orden").first()
        or departamento.nivel
    )


def _colgar(nombre, departamento, nivel, orden):
    """El área queda bajo el departamento, en el nivel de sus áreas; si no
    existe, se crea (salvo Talento Humano, que no es de este organigrama).
    Devuelve la unidad, o None."""
    unidad = _buscar(nombre)
    if unidad is None:
        if nombre not in AREAS:
            return None
        unidad = UnidadOrganizacional.objects.create(
            nombre=nombre, nivel=nivel, padre=departamento, orden=orden
        )
        departamentos_del_organigrama.sincronizar(unidad)
        return unidad
    if unidad.padre_id != departamento.id or unidad.nivel_id != nivel.id:
        if unidad.padre_id != departamento.id:
            unidad.orden = orden
        unidad.padre = departamento
        unidad.nivel = nivel
        unidad.save(update_fields=["padre", "nivel", "orden", "updated_at"])
        departamentos_del_organigrama.sincronizar(unidad)
    return unidad


def _trasladar(destino, origen, nombres) -> None:
    """Pasa a `destino` los cargos de `origen` con esos nombres: conservan su
    rol, su perfil y quienes los ocupan."""
    buscados = {_normal(n) for n in nombres}
    for cargo in Cargo.objects.filter(unidad__nombre__iexact=origen):
        if _normal(cargo.nombre) in buscados and cargo.unidad_id != destino.id:
            cargo.unidad = destino
            cargo.save(update_fields=["unidad", "updated_at"])


def _cabeza_de_talento_humano(unidad) -> None:
    """El cargo más alto de Talento Humano (el que reporta fuera del área)
    reporta a `JEFE_DE_TALENTO_HUMANO`."""
    jefe = (
        Cargo.objects.filter(nombre__iexact=JEFE_DE_TALENTO_HUMANO, activo=True)
        .exclude(unidad=unidad)
        .order_by("id")
        .first()
    )
    if jefe is None:
        return
    for cargo in Cargo.objects.filter(unidad=unidad, activo=True).exclude(jefe__unidad=unidad):
        if cargo.jefe_id != jefe.id:
            cargo.jefe = jefe
            cargo.save(update_fields=["jefe", "updated_at"])


def _sin_pasar_a_su_jefe(unidades) -> None:
    """Ningún cargo por encima del nivel de su jefe (`niveles_cargo.validar_jefe`
    no dejaría editarlo): toma el de su jefe, de arriba hacia abajo."""
    cambio = True
    while cambio:
        cambio = False
        for cargo in Cargo.objects.filter(unidad__in=unidades, activo=True).select_related("jefe"):
            if cargo.jefe_id is None:
                continue
            if niveles_cargo.ORDEN[cargo.jefe.nivel] > niveles_cargo.ORDEN[cargo.nivel]:
                cargo.nivel = cargo.jefe.nivel
                cargo.save(update_fields=["nivel", "updated_at"])
                cambio = True


def cambiar() -> None:
    """Los cambios, sin anotarlos: los anota quien llama (`aplicar` o la
    migración)."""
    departamento = _unidad(UNIDAD, (), PADRE)
    if departamento is None:
        return
    nivel = _nivel_de_area(departamento)
    areas = {
        nombre: _colgar(nombre, departamento, nivel, orden) for orden, nombre in enumerate(ORDEN)
    }
    for destino, (origen, nombres) in TRASLADOS.items():
        _trasladar(areas[destino], origen, nombres)
    # Primero el Jefe del departamento, al que reportan las áreas.
    levantar(UNIDAD, CARGOS, padre=PADRE)
    for nombre, cargos in AREAS.items():
        levantar(nombre, cargos, padre=UNIDAD)
    if areas[TALENTO_HUMANO] is not None:
        _cabeza_de_talento_humano(areas[TALENTO_HUMANO])
    unidades = [departamento, *(areas[n] for n in AREAS)]
    _sin_pasar_a_su_jefe(unidades)
    # Otra vuelta a los roles: al renombrar dos cargos que se cruzan (la
    # Asistente de Tesorería toma el nombre de las asistentes que pasan a COD)
    # el primero no encuentra libre su nombre hasta que el otro cambia.
    for cargo in Cargo.objects.filter(unidad__in=unidades).select_related(
        "rol", "unidad", "empresa", "jefe"
    ):
        roles_de_cargo.asegurar_rol(cargo)
