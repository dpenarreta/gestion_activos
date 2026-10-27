"""Las migraciones 0035 (Innovación y Transformación Digital pasa a «TI»)
y 0036 (el nivel «Departamento» pasa a «Área»), del 27/10/2026."""

import importlib

from apps.organizacion.models import (
    Cargo,
    NivelJerarquico,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.roles_de_cargo import asegurar_rol

migracion = importlib.import_module("apps.organizacion.migrations.0035_renombrar_innovacion_a_ti")


def test_renombra_unidad_departamento_y_roles(db):
    nivel = NivelJerarquico.objects.create(nombre="Departamento", orden=1)
    otra = UnidadOrganizacional.objects.create(nombre="Comercial", nivel=nivel)
    ti = UnidadOrganizacional.objects.create(
        nombre="Innovación y Transformación Digital", nivel=nivel
    )
    from apps.organizacion import departamentos_del_organigrama

    departamentos_del_organigrama.sincronizar(ti)
    jefe = Cargo.objects.create(nombre="Coordinador TI", unidad=ti)
    asistente = Cargo.objects.create(nombre="Asistente de Sistemas", unidad=ti, jefe=jefe)
    Cargo.objects.create(nombre="Asistente de Sistemas", unidad=otra)
    for cargo in Cargo.objects.all():
        asegurar_rol(cargo)
    asistente.refresh_from_db()
    assert "Innovación" in asistente.rol.name

    migracion.aplicar(None, None)

    ti.refresh_from_db()
    asistente.refresh_from_db()
    assert ti.nombre == "TI" and ti.departamento.nombre == "TI"
    assert asistente.rol.name == "Asistente de Sistemas · TI"
    assert asistente.nombre == "Asistente de Sistemas"
    assert VersionOrganigrama.objects.count() == 1
    # Repetirla no hace nada.
    migracion.aplicar(None, None)
    assert VersionOrganigrama.objects.count() == 1


nivel_a_area = importlib.import_module(
    "apps.organizacion.migrations.0036_nivel_departamento_a_area"
)


def test_el_nivel_departamento_pasa_a_area(db):
    nivel = NivelJerarquico.objects.create(nombre="Departamento", orden=2)

    nivel_a_area.aplicar(None, None)

    nivel.refresh_from_db()
    assert nivel.nombre == "Área"
    (version,) = VersionOrganigrama.objects.all()
    assert version.cambios
    nivel_a_area.aplicar(None, None)
    assert VersionOrganigrama.objects.count() == 1


def test_si_ya_hay_un_nivel_area_no_se_toca(db):
    NivelJerarquico.objects.create(nombre="Área", orden=3)
    departamento = NivelJerarquico.objects.create(nombre="Departamento", orden=2)

    nivel_a_area.aplicar(None, None)

    departamento.refresh_from_db()
    assert departamento.nombre == "Departamento"
    assert not VersionOrganigrama.objects.exists()
