"""El organigrama de Procesos y Proyectos (27/10/2026): el Gerente General
lleva la gerencia, así que el Jefe de Procesos le reporta directamente y el
cargo aparte de gerente se desactiva si nadie lo ocupa."""

from apps.organizacion import procesos_2026
from apps.organizacion.models import (
    Cargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
)
from apps.organizacion.roles_de_cargo import asegurar_rol


def _area_como_estaba():
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
    procesos = UnidadOrganizacional.objects.create(
        nombre="Procesos y Proyectos", nivel=nivel, padre=general
    )
    gg = Cargo.objects.create(nombre="Gerente General", unidad=general)
    gerente = Cargo.objects.create(
        nombre="Gerente de Procesos y Proyectos", unidad=procesos, jefe=gg
    )
    jefe = Cargo.objects.create(
        nombre="Jefe de Procesos y Mejora Continua", unidad=procesos, jefe=gerente
    )
    analista = Cargo.objects.create(
        nombre="Analista de Procesos y Mejora", unidad=procesos, jefe=jefe
    )
    Cargo.objects.create(nombre="Asistente de Procesos", unidad=procesos, jefe=jefe)
    for cargo in Cargo.objects.all():
        asegurar_rol(cargo)
    return procesos, gg, gerente, jefe, analista


def test_el_jefe_reporta_al_gerente_general(db):
    procesos, gg, gerente, jefe, analista = _area_como_estaba()

    assert procesos_2026.aplicar()

    jefe.refresh_from_db()
    assert jefe.jefe == gg
    gerente.refresh_from_db()
    assert gerente.activo is False
    analista.refresh_from_db()
    assert analista.nombre == "Analista de Procesos y Mejora Continua"
    activos = set(
        Cargo.objects.filter(unidad=procesos, activo=True).values_list("nombre", flat=True)
    )
    assert activos == {
        "Jefe de Procesos y Mejora Continua",
        "Analista de Procesos y Mejora Continua",
        "Asistente de Procesos y Mejora Continua",
        "Auditor de Procesos Zona Norte",
        "Auditor de Procesos Zona Sur",
    }
    assert procesos_2026.aplicar() == []


def test_si_alguien_ocupa_el_cargo_de_gerente_se_queda(db):
    _, _, gerente, _, _ = _area_como_estaba()
    OcupanteCargo.objects.create(cargo=gerente, nombres="Ana", apellidos="Prueba")

    procesos_2026.aplicar()

    gerente.refresh_from_db()
    assert gerente.activo is True
