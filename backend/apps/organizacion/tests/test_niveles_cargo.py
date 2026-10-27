"""Niveles jerárquicos por cargo (27/10/2026): Gerencia General › Gerencia
de Área › Jefatura › Coordinación › Operativo de área › Asistente de área."""

import importlib

import pytest

from apps.organizacion import niveles_cargo
from apps.organizacion.models import (
    Cargo,
    NivelJerarquico,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/organizacion/"
migracion = importlib.import_module("apps.organizacion.migrations.0038_asignar_niveles_de_cargo")


@pytest.mark.parametrize(
    "nombre, nivel",
    [
        ("Gerente General", "gerencia_general"),
        ("Gerente Gestión Humana", "gerencia_area"),
        ("Gerente de Procesos y Proyectos", "gerencia_area"),
        ("Jefe de Innovación y Transformación Digital", "jefatura"),
        ("Jefe de Nómina", "jefatura"),
        ("Coordinador de Aduana", "coordinacion"),
        ("Coordinador Nacional de GGHH", "coordinacion"),
        ("Supervisor COMEX Temu", "operativo"),
        ("Analista Programador Senior", "operativo"),
        ("Salud Ocupacional", "operativo"),
        ("Auxiliar de Aduana", "operativo"),
        ("Mecanizador", "operativo"),
        ("Asistente de Sistemas", "asistente"),
        ("Asistente Gestión Humana Zona Sur", "asistente"),
    ],
)
def test_el_nivel_sale_del_nombre(nombre, nivel):
    assert niveles_cargo.sugerido(nombre) == nivel


def _unidad():
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    return UnidadOrganizacional.objects.create(nombre="TI", nivel=nivel)


def test_un_cargo_nuevo_toma_el_nivel_de_su_nombre_y_se_puede_cambiar(db):
    unidad = _unidad()
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    jefe = cliente.post(f"{BASE}cargos/", {"nombre": "Jefe TI", "unidad": unidad.id}, format="json")
    assert jefe.status_code == 201, jefe.data
    assert jefe.data["nivel"] == "jefatura"
    soporte = cliente.post(
        f"{BASE}cargos/",
        {
            "nombre": "Soporte",
            "unidad": unidad.id,
            "jefe": jefe.data["id"],
            "nivel": "coordinacion",
        },
        format="json",
    )
    assert soporte.status_code == 201 and soporte.data["nivel"] == "coordinacion"
    arbol = cliente.get(f"{BASE}organigrama/").json()
    assert [n["nombre"] for n in arbol["niveles_cargo"]][:3] == [
        "Gerencia General",
        "Gerencia de Área",
        "Jefatura",
    ]
    assert {c["nombre"]: c["nivel"] for c in arbol["cargos"]}["Soporte"] == "coordinacion"


def test_no_se_reporta_a_un_cargo_de_nivel_mas_bajo(db):
    unidad = _unidad()
    coordinador = Cargo.objects.create(nombre="Coordinador TI", unidad=unidad, nivel="coordinacion")
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    respuesta = cliente.post(
        f"{BASE}cargos/",
        {
            "nombre": "Jefe de Soporte",
            "unidad": unidad.id,
            "jefe": coordinador.id,
            "nivel": "jefatura",
        },
        format="json",
    )
    assert respuesta.status_code == 400
    assert "no puede reportarle" in str(respuesta.data["error"]["details"]["jefe"])
    # Sin elegir el nivel, toma el de su jefe y no queda por encima.
    respuesta = cliente.post(
        f"{BASE}cargos/",
        {"nombre": "Jefe de Soporte", "unidad": unidad.id, "jefe": coordinador.id},
        format="json",
    )
    assert respuesta.status_code == 201 and respuesta.data["nivel"] == "coordinacion"
    # Del mismo nivel sí (el Analista Programador al Senior).
    senior = Cargo.objects.create(nombre="Analista Senior", unidad=unidad, nivel="operativo")
    respuesta = cliente.post(
        f"{BASE}cargos/",
        {"nombre": "Analista", "unidad": unidad.id, "jefe": senior.id},
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data


def test_no_se_baja_el_nivel_si_le_reportan_cargos_mas_altos(db):
    unidad = _unidad()
    jefe = Cargo.objects.create(nombre="Jefe TI", unidad=unidad, nivel="jefatura")
    Cargo.objects.create(nombre="Coordinador TI", unidad=unidad, jefe=jefe, nivel="coordinacion")
    _, cliente = _cuenta("ana", "institucional.ver", "institucional.editar")
    respuesta = cliente.patch(f"{BASE}cargos/{jefe.id}/", {"nivel": "operativo"}, format="json")
    assert respuesta.status_code == 400
    assert "Coordinador TI" in str(respuesta.data["error"]["details"]["nivel"])


def test_la_migracion_asigna_niveles_y_sube_al_jefe_de_nomina(db):
    unidad = _unidad()
    nacional = Cargo.objects.create(nombre="Jefe Nacional de Talento Humano y SSO", unidad=unidad)
    coordinador = Cargo.objects.create(
        nombre="Coordinador Nacional de GGHH", unidad=unidad, jefe=nacional
    )
    nomina = Cargo.objects.create(nombre="Jefe de Nómina", unidad=unidad, jefe=coordinador)
    asistente = Cargo.objects.create(nombre="Asistente de Nómina", unidad=unidad, jefe=nomina)

    migracion.aplicar(None, None)

    for cargo in (nacional, coordinador, nomina, asistente):
        cargo.refresh_from_db()
    assert (nacional.nivel, coordinador.nivel, nomina.nivel, asistente.nivel) == (
        "jefatura",
        "coordinacion",
        "jefatura",
        "asistente",
    )
    assert nomina.jefe == nacional
    (version,) = VersionOrganigrama.objects.all()
    assert any("nivel jerárquico" in linea for linea in version.cambios)
    assert any("jefe inmediato" in linea for linea in version.cambios)
