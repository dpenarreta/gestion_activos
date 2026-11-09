"""El organigrama del área de Cartera (09/11/2026).

Cartera queda como área propia bajo la Gerencia General, con su Jefatura
reportando al Gerente General. En producción no existía y se crea; en local
vivía dentro de Financiero Administrativo y se mueve, conservando los cargos
que ya tenía (con su rol). Repetirlo no cambia nada.
"""

from apps.organizacion import cartera_2026, versiones
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
    gerencia_nivel = NivelJerarquico.objects.create(nombre="Gerencia General", orden=1)
    area = NivelJerarquico.objects.create(nombre="Área", orden=2)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=gerencia_nivel)
    ti = UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=area, padre=general)
    gerente = Cargo.objects.create(
        nombre="Gerente General", unidad=general, plazas=1, nivel=NivelCargo.OPERATIVO
    )
    asegurar_rol(gerente)
    return general, ti, gerente


def _activos(unidad):
    return {
        (c.nombre, c.jefe.nombre if c.jefe_id else None): c
        for c in Cargo.objects.filter(unidad=unidad, activo=True).select_related("jefe")
    }


def _como_la_migracion():
    with versiones.sin_peticion("prueba") as resultado:
        cartera_2026.cambiar()
    return resultado["lineas"]


def test_crea_el_area_bajo_la_gerencia_general(db):
    general, ti, _gerente = _gerencia()

    assert _como_la_migracion()

    cartera = UnidadOrganizacional.objects.get(nombre="Cartera")
    assert cartera.padre_id == general.id
    assert cartera.nivel_id == ti.nivel_id
    activos = _activos(cartera)
    assert len(activos) == len(cartera_2026.CARGOS)
    assert ("Jefe de Cartera", "Gerente General") in activos
    # Dos «Asistente de Cartera» y dos «Telecobrador»: los distingue su jefe.
    assert activos[("Asistente de Cartera", "Jefe de Cartera")].plazas == 3
    assert activos[("Asistente de Cartera", "Coordinador de Cartera")].plazas == 1
    assert activos[("Telecobrador", "Jefe de Cartera")].plazas == 2
    # Sin cuenta en la intranet, las personas quedan como ocupantes.
    telecobrador = activos[("Telecobrador", "Jefe de Cartera")]
    assert sorted(str(o) for o in telecobrador.ocupantes_sin_cuenta.all()) == [
        "Belén Cuichán",
        "Cindy Violeta Acosta Gualpa",
    ]
    assert OcupanteCargo.objects.filter(cargo__unidad=cartera).count() == 12


def test_en_local_la_pasa_de_financiero_administrativo(db):
    general, _ti, _gerente = _gerencia()
    gerencia_area = NivelJerarquico.objects.create(nombre="Gerencia / Jefatura", orden=3)
    financiero = UnidadOrganizacional.objects.create(
        nombre="Financiero Administrativo", nivel=gerencia_area, padre=general
    )
    cartera = UnidadOrganizacional.objects.create(
        nombre="Cartera", nivel=gerencia_area, padre=financiero
    )
    jefe_fin = Cargo.objects.create(
        nombre="Jefe Financiero Administrativo",
        unidad=financiero,
        plazas=1,
        nivel=NivelCargo.OPERATIVO,
    )
    jefe = Cargo.objects.create(
        nombre="Jefe de Cartera",
        unidad=cartera,
        jefe=jefe_fin,
        plazas=1,
        nivel=NivelCargo.OPERATIVO,
    )
    asegurar_rol(jefe)
    rol = jefe.rol_id

    _como_la_migracion()

    cartera.refresh_from_db()
    assert cartera.padre_id == general.id
    jefe.refresh_from_db()
    assert jefe.jefe.nombre == "Gerente General"
    assert jefe.rol_id == rol
    assert [str(o) for o in jefe.ocupantes_sin_cuenta.all()] == ["Sara Fernanda Marroquín García"]


def test_repetirlo_no_cambia_nada(db):
    _gerencia()
    _como_la_migracion()

    assert _como_la_migracion() == []
    assert cartera_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == 1
