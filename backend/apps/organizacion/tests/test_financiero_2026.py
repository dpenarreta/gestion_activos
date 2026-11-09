"""El organigrama del departamento Financiero Administrativo (09/11/2026).

Contabilidad, Administración, Cartera, Facturación, Nómina, Siniestros,
Bodega, Transporte y Talento Humano quedan como áreas de Financiero
Administrativo. En producción puede faltar casi todo y se crea; en local ya
estaban el departamento con sus cargos, Cartera y Talento Humano bajo la
Gerencia General, y se mueven conservando los cargos (con su rol).
Repetirlo no cambia nada.
"""

import pytest

from apps.organizacion import cartera_2026, financiero_2026, versiones
from apps.organizacion.models import (
    Cargo,
    NivelCargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.roles_de_cargo import asegurar_rol


def _gerencia():
    gerencia_nivel = NivelJerarquico.objects.create(nombre="Gerente General", orden=1)
    departamento = NivelJerarquico.objects.create(nombre="Gerencia / Jefatura", orden=2)
    area = NivelJerarquico.objects.create(nombre="Área", orden=3)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=gerencia_nivel)
    UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=departamento, padre=general)
    gerente = Cargo.objects.create(
        nombre="Gerente General", unidad=general, plazas=1, nivel=NivelCargo.GERENCIA_GENERAL
    )
    asegurar_rol(gerente)
    return general, departamento, area


def _cargo(nombre, unidad, jefe=None, plazas=1, nivel=NivelCargo.OPERATIVO, personas=()):
    cargo = Cargo.objects.create(
        nombre=nombre, unidad=unidad, jefe=jefe, plazas=plazas, nivel=nivel
    )
    asegurar_rol(cargo)
    for nombres, apellidos in personas:
        OcupanteCargo.objects.create(cargo=cargo, nombres=nombres, apellidos=apellidos)
    return cargo


def _como_en_local():
    """Lo que había en local antes del levantamiento."""
    general, departamento, area = _gerencia()
    financiero = UnidadOrganizacional.objects.create(
        nombre="Financiero Administrativo", nivel=departamento, padre=general
    )
    gerente = Cargo.objects.get(nombre="Gerente General")
    jefe = _cargo("Jefe Financiero Administrativo", financiero, gerente, nivel=NivelCargo.JEFATURA)
    contable = _cargo(
        "Coordinador de Contabilidad", financiero, jefe, nivel=NivelCargo.COORDINACION
    )
    asistente_contable = _cargo(
        "Asistente de Contabilidad", financiero, contable, 5, NivelCargo.ASISTENTE
    )
    siniestros = _cargo(
        "Coordinador de Siniestros", financiero, jefe, nivel=NivelCargo.COORDINACION
    )
    _cargo("Asistente de Siniestros", financiero, siniestros, 3, NivelCargo.ASISTENTE)
    logistico = _cargo("Coordinador Logístico", financiero, jefe, nivel=NivelCargo.COORDINACION)
    _cargo("Asistente de Logística", financiero, logistico, 2, NivelCargo.ASISTENTE)
    administrativo = _cargo("Asistente Administrativo", financiero, jefe, 3, NivelCargo.ASISTENTE)
    _cargo("Mensajero", financiero, jefe)
    _cargo("Servicios Generales", financiero, jefe, 2)
    facturacion = UnidadOrganizacional.objects.create(
        nombre="Facturación", nivel=area, padre=financiero
    )
    jefe_fact = _cargo("Jefe de Facturación", facturacion, jefe, nivel=NivelCargo.JEFATURA)
    coord_fact = _cargo(
        "Coordinador de Facturación", facturacion, jefe_fact, nivel=NivelCargo.COORDINACION
    )
    auxiliar = _cargo("Auxiliar de Facturación", facturacion, coord_fact)
    UnidadOrganizacional.objects.create(nombre="Contabilidad", nivel=departamento, padre=general)

    gth = UnidadOrganizacional.objects.create(
        nombre="Gestión de Talento Humano", nivel=departamento, padre=general
    )
    gerente_gh = _cargo(
        "Gerente Gestión Humana",
        gth,
        gerente,
        nivel=NivelCargo.GERENCIA_AREA,
        personas=[("Cristina", "Granda")],
    )
    jefe_th = _cargo(
        "Jefe Nacional de Talento Humano y SSO", gth, gerente_gh, nivel=NivelCargo.JEFATURA
    )
    jefe_nomina = _cargo(
        "Jefe de Nómina", gth, jefe_th, nivel=NivelCargo.JEFATURA, personas=[("Elsi", "Maldonado")]
    )
    asistente_nomina = _cargo(
        "Asistente de Nómina",
        gth,
        jefe_nomina,
        nivel=NivelCargo.ASISTENTE,
        personas=[("Madelyn Cristina", "Hurtado Montalvo")],
    )
    # Cartera, como la dejó `cartera_2026`.
    with versiones.sin_peticion("cartera"):
        cartera_2026.cambiar()
    return {
        "general": general,
        "financiero": financiero,
        "jefe": jefe,
        "contable": contable,
        "asistente_contable": asistente_contable,
        "siniestros": siniestros,
        "administrativo": administrativo,
        "auxiliar": auxiliar,
        "gth": gth,
        "gerente_gh": gerente_gh,
        "jefe_nomina": jefe_nomina,
        "asistente_nomina": asistente_nomina,
        "area": area,
    }


def _activos(unidad):
    return {
        (c.nombre, c.jefe.nombre if c.jefe_id else None): c
        for c in Cargo.objects.filter(unidad=unidad, activo=True).select_related("jefe")
    }


def _personas(cargo):
    return sorted(str(o) for o in cargo.ocupantes_sin_cuenta.all())


def _como_la_migracion():
    with versiones.sin_peticion("prueba") as resultado:
        financiero_2026.cambiar()
    return resultado["lineas"]


def test_crea_el_departamento_desde_cero(db):
    general, departamento, area = _gerencia()

    assert _como_la_migracion()

    financiero = UnidadOrganizacional.objects.get(nombre="Financiero Administrativo")
    assert financiero.padre_id == general.id
    assert financiero.nivel_id == departamento.id
    assert _personas(Cargo.objects.get(nombre="Jefe Financiero Administrativo")) == [
        "Christian Coque"
    ]
    for nombre in financiero_2026.AREAS:
        unidad = UnidadOrganizacional.objects.get(nombre=nombre)
        assert unidad.padre_id == financiero.id
        assert unidad.nivel_id == area.id
        assert len(_activos(unidad)) == len(financiero_2026.AREAS[nombre])
    # Talento Humano no estaba: no se inventa.
    assert not UnidadOrganizacional.objects.filter(nombre="Gestión de Talento Humano").exists()
    jefa = Cargo.objects.get(nombre="Jefe de Cartera")
    assert jefa.jefe.nombre == "Gerente General"
    assert (
        Cargo.objects.get(nombre="Jefe de Bodega").jefe.nombre == "Jefe Financiero Administrativo"
    )


def test_en_local_mueve_y_conserva_los_cargos(db):
    antes = _como_en_local()
    roles = {k: c.rol_id for k, c in antes.items() if isinstance(c, Cargo)}
    cartera = UnidadOrganizacional.objects.get(nombre="Cartera")
    tesoreria = Cargo.objects.get(nombre="Asistente de Tesorería")
    coordinador_cartera = Cargo.objects.get(nombre="Coordinador de Cartera")
    asistentes_jefe = Cargo.objects.get(
        nombre="Asistente de Cartera", jefe__nombre="Jefe de Cartera"
    )

    _como_la_migracion()

    financiero = antes["financiero"]
    # Los cargos que eran el mismo puesto: misma fila, mismo rol, otra unidad.
    contabilidad = UnidadOrganizacional.objects.get(nombre="Contabilidad")
    assert contabilidad.padre_id == financiero.id
    assert contabilidad.nivel_id == antes["area"].id
    for clave in ("contable", "asistente_contable", "siniestros", "administrativo", "auxiliar"):
        cargo = antes[clave]
        cargo.refresh_from_db()
        assert cargo.activo
        assert cargo.rol_id == roles[clave]
    assert antes["contable"].unidad_id == contabilidad.id
    assert antes["siniestros"].nombre == "Jefe de Siniestros"
    assert antes["siniestros"].nivel == NivelCargo.JEFATURA
    assert antes["administrativo"].nombre == "Asistente Administrativo Quito"
    assert antes["auxiliar"].nombre == "Asistente de Facturación Guayaquil"
    # Los dudosos, sin nadie, se desactivan; no se borran.
    for nombre in ("Coordinador Logístico", "Asistente de Logística", "Mensajero"):
        assert not Cargo.objects.get(nombre=nombre, unidad=financiero).activo
    assert set(_activos(financiero)) == {("Jefe Financiero Administrativo", "Gerente General")}

    # Cartera: bajo Financiero, su jefa reporta al Gerente General.
    cartera.refresh_from_db()
    assert cartera.padre_id == financiero.id
    assert cartera.nivel_id == antes["area"].id
    activos = _activos(cartera)
    assert ("Jefe de Cartera", "Gerente General") in activos
    tesoreria.refresh_from_db()
    assert tesoreria.nombre == "Asistente de Cartera"
    assert _personas(tesoreria) == ["Daniela Lorena Marroquín García"]
    coordinador_cartera.refresh_from_db()
    assert coordinador_cartera.nombre == "Coordinador de Cartera Zona Sur"
    asistentes_jefe.refresh_from_db()
    assert asistentes_jefe.nombre == "COD"
    assert asistentes_jefe.plazas == 2
    assert _personas(asistentes_jefe) == ["Jennifer Bailón", "Lorena Elizabeth Espinosa Tituaña"]
    assert _personas(activos[("Telecobrador Guayaquil", "Coordinador de Cartera Zona Sur")]) == [
        "Cindy Carolina Valdez Muñoz",
        "Irene Yesenia Sarcos Maruri",
    ]
    assert not Cargo.objects.filter(nombre="Asistente de Tesorería", activo=True).exists()
    # Nadie se duplicó: las 12 personas de Cartera siguen siendo 12.
    assert OcupanteCargo.objects.filter(cargo__unidad=cartera).count() == 12
    assert OcupanteCargo.objects.filter(cargo__unidad=cartera, cargo__activo=False).count() == 0
    # Todos bajo la Asistente de Cartera, sin cadena, y no por encima de ella.
    for nombre in ("Telecobrador Quito", "Contados", "COD", "Recaudador Quito"):
        cargo = activos[(nombre, "Asistente de Cartera")]
        assert cargo.nivel == NivelCargo.ASISTENTE

    # Talento Humano bajo Financiero; su Gerente sigue con el Gerente General.
    gth = antes["gth"]
    gth.refresh_from_db()
    assert gth.padre_id == financiero.id
    antes["gerente_gh"].refresh_from_db()
    assert antes["gerente_gh"].jefe.nombre == financiero_2026.JEFE_DE_TALENTO_HUMANO
    assert antes["gerente_gh"].nivel == NivelCargo.GERENCIA_AREA

    # Nómina: sus cargos salen de Talento Humano con su rol y sus personas.
    nomina = UnidadOrganizacional.objects.get(nombre="Nómina")
    for clave in ("jefe_nomina", "asistente_nomina"):
        cargo = antes[clave]
        cargo.refresh_from_db()
        assert cargo.unidad_id == nomina.id
        assert cargo.rol_id == roles[clave]
    assert antes["jefe_nomina"].jefe_id == antes["jefe"].id
    assert _personas(antes["jefe_nomina"]) == ["Elsi Maldonado"]
    assert _personas(antes["asistente_nomina"]) == ["Madelyn Cristina Hurtado Montalvo"]


def test_el_bloque_de_quito_no_es_una_cadena(db):
    _gerencia()
    _como_la_migracion()

    administracion = UnidadOrganizacional.objects.get(nombre="Administración")
    activos = _activos(administracion)
    for nombre in (
        "Asistente Administrativo 2 Quito",
        "Mensajero Quito",
        "Servicios Generales Quito",
        "Recepcionista Quito",
    ):
        assert (nombre, "Asistente Administrativo Quito") in activos
    for nombre in (
        "Asistente Administrativo Quito",
        "Administrador Guayaquil",
        "Administrador Cuenca",
    ):
        assert (nombre, "Jefe Financiero Administrativo") in activos
    servicios = activos[("Servicios Generales Guayaquil", "Administrador Guayaquil")]
    assert servicios.plazas == 2
    assert _personas(servicios) == ["Israel Suarez", "Javier Solis"]
    # Ecuacopia es un proveedor, no un cargo.
    assert not Cargo.objects.filter(nombre__icontains="ecuacopia").exists()
    assert not OcupanteCargo.objects.filter(nombres__icontains="ecuacopia").exists()


def test_la_vacante_de_siniestros(db):
    _gerencia()
    _como_la_migracion()

    asistente = Cargo.objects.get(nombre="Asistente de Siniestros")
    assert asistente.jefe.nombre == "Jefe de Siniestros"
    assert asistente.plazas == 3
    assert _personas(asistente) == ["Daniel Silva", "Esteban Minda"]


def test_los_roles_nuevos_ven_su_area_y_no_todo(db):
    _gerencia()
    _como_la_migracion()

    for nombre in ("Jefe de Bodega", "Contados", "Recepcionista Quito"):
        rol = Cargo.objects.get(nombre=nombre).rol
        permisos = set(rol.permissions.values_list("codename", flat=True))
        assert "institucional.ver_area" in permisos
        assert "institucional.ver" not in permisos


@pytest.mark.parametrize("como_en_local", [False, True])
def test_repetirlo_no_cambia_nada(db, como_en_local):
    if como_en_local:
        _como_en_local()
    else:
        _gerencia()
    _como_la_migracion()
    versiones_antes = VersionOrganigrama.objects.count()
    roles = sorted(Cargo.objects.values_list("id", "rol__name"))

    assert _como_la_migracion() == []
    assert financiero_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == versiones_antes
    # Los roles quedan con su nombre a la primera.
    assert sorted(Cargo.objects.values_list("id", "rol__name")) == roles
