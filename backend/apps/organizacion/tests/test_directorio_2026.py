"""El Directorio, horizontal a la Gerencia General (19/11/2026).

Fija que el Directorio quede como otra raíz del organigrama, a la altura de
la Gerencia General (ninguno es jefe del otro); que el Gerente de Procesos y
Proyectos pase a él sin jefe y conserve a su equipo; que se cree el Jefe de
Finanzas y Administración; y que el Jefe Financiero Administrativo le
reporte y además, en línea punteada, al Gerente General. Repetirlo no
cambia nada.
"""

from apps.organizacion import directorio_2026, versiones
from apps.organizacion.models import (
    Cargo,
    NivelCargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
)
from apps.organizacion.roles_de_cargo import asegurar_rol


def _organigrama_de_hoy():
    raiz = NivelJerarquico.objects.create(nombre="Gerencia General", orden=1)
    area = NivelJerarquico.objects.create(nombre="Área", orden=2)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=raiz)
    procesos = UnidadOrganizacional.objects.create(
        nombre="Procesos y Proyectos", nivel=area, padre=general
    )
    financiero = UnidadOrganizacional.objects.create(
        nombre="Financiero Administrativo", nivel=area, padre=general
    )
    cargos = {}

    def cargo(clave, nombre, unidad, jefe=None, nivel=NivelCargo.JEFATURA):
        cargos[clave] = Cargo.objects.create(
            nombre=nombre, unidad=unidad, jefe=cargos.get(jefe), nivel=nivel
        )
        asegurar_rol(cargos[clave])

    cargo("gg", "Gerente General", general, nivel=NivelCargo.GERENCIA_GENERAL)
    cargo("procesos", "Gerente de Procesos y Proyectos", procesos, "gg", NivelCargo.GERENCIA_AREA)
    cargo("jefe_procesos", "Jefe de Procesos y Mejora Continua", procesos, "procesos")
    cargo("financiero", "Jefe Financiero Administrativo", financiero, "gg")
    cargo("nomina", "Jefe de Nómina", financiero, "financiero")
    OcupanteCargo.objects.create(
        cargo=cargos["financiero"], nombres="Persona", apellidos="Financiera"
    )
    return general, cargos


def _como_la_migracion():
    with versiones.sin_peticion("prueba") as resultado:
        directorio_2026.cambiar()
    return resultado["lineas"]


def test_el_directorio_queda_a_la_altura_de_la_gerencia_general(db):
    general, cargos = _organigrama_de_hoy()
    rol_procesos = cargos["procesos"].rol_id

    assert _como_la_migracion()

    directorio = UnidadOrganizacional.objects.get(nombre="Directorio")
    assert directorio.padre_id is None
    # Su nivel propio, a la altura del de la Gerencia General: no se lee como
    # una unidad «Gerencia General» (corrección del usuario).
    assert directorio.nivel.nombre == "Directorio"
    # Su nivel va primero: se dibuja arriba de todo el organigrama.
    assert directorio.nivel.orden < general.nivel.orden
    assert directorio.nivel_id != general.nivel_id
    assert directorio.departamento is not None  # su Área, como toda unidad

    gg = Cargo.objects.get(pk=cargos["gg"].pk)
    assert gg.jefe_id is None and gg.unidad_id == general.id

    procesos = Cargo.objects.get(pk=cargos["procesos"].pk)
    assert procesos.unidad_id == directorio.id
    assert procesos.jefe_id is None
    assert procesos.rol_id == rol_procesos
    assert Cargo.objects.get(pk=cargos["jefe_procesos"].pk).jefe_id == procesos.pk

    finanzas = Cargo.objects.get(nombre="Jefe Administrativo Financiero Corporativo")
    assert finanzas.unidad_id == directorio.id and finanzas.jefe_id is None
    assert finanzas.nivel == NivelCargo.DIRECTORIO
    assert finanzas.rol_id is not None

    # Presidente arriba; los dos Directores, al mismo nivel, le reportan.
    presidente = Cargo.objects.get(nombre="Presidente del Directorio")
    assert presidente.unidad_id == directorio.id and presidente.jefe_id is None
    directores = list(
        Cargo.objects.filter(nombre__in=["Director Ejecutivo", "Director Financiero"])
    )
    assert len(directores) == 2
    assert all(d.jefe_id == presidente.pk and d.unidad_id == directorio.id for d in directores)
    # Todos los del Directorio, en el nivel de cargo Directorio; el Gerente
    # General, en el suyo.
    assert {presidente.nivel, *(d.nivel for d in directores)} == {NivelCargo.DIRECTORIO}
    procesos.refresh_from_db()
    assert procesos.nivel == NivelCargo.DIRECTORIO
    assert gg.nivel == NivelCargo.GERENCIA_GENERAL
    ids_directores = {d.pk for d in directores}

    # El Comité Ejecutivo informa a los dos Directores, sin línea directa.
    for miembro in (procesos, finanzas, gg):
        miembro.refresh_from_db()
        assert set(miembro.jefes_secundarios.values_list("pk", flat=True)) == ids_directores
        assert miembro.jefe_id not in ids_directores

    financiero = Cargo.objects.get(pk=cargos["financiero"].pk)
    assert financiero.jefe_id == finanzas.pk
    assert list(financiero.jefes_secundarios.values_list("pk", flat=True)) == [gg.pk]
    assert [str(o) for o in financiero.ocupantes_sin_cuenta.all()] == ["Persona Financiera"]
    assert Cargo.objects.get(pk=cargos["nomina"].pk).jefe_id == financiero.pk

    # Nadie del Directorio reporta al Gerente General ni al revés.
    assert not Cargo.objects.filter(unidad=directorio, jefe=gg).exists()
    assert not Cargo.objects.filter(pk=gg.pk, jefe__unidad=directorio).exists()


def test_repetirlo_no_cambia_nada(db):
    _organigrama_de_hoy()
    _como_la_migracion()
    assert _como_la_migracion() == []
    assert UnidadOrganizacional.objects.filter(nombre="Directorio").count() == 1
    assert Cargo.objects.filter(nombre="Jefe Administrativo Financiero Corporativo").count() == 1
    assert Cargo.objects.filter(nombre="Presidente del Directorio").count() == 1


def test_si_la_gerencia_general_colgaba_del_directorio_quedan_las_dos_como_raiz(db):
    general, _ = _organigrama_de_hoy()
    directorio = UnidadOrganizacional.objects.create(nombre="Directorio", nivel=general.nivel)
    general.padre = directorio
    general.save()

    _como_la_migracion()

    general.refresh_from_db()
    directorio.refresh_from_db()
    assert general.padre_id is None and directorio.padre_id is None


def test_renombra_el_cargo_que_creo_la_0052(db):
    _organigrama_de_hoy()
    directorio = UnidadOrganizacional.objects.create(
        nombre="Directorio", nivel=NivelJerarquico.objects.get(nombre="Gerencia General")
    )
    viejo = Cargo.objects.create(
        nombre="Jefe de Finanzas y Administración", unidad=directorio, nivel=NivelCargo.JEFATURA
    )
    _como_la_migracion()
    viejo.refresh_from_db()
    assert viejo.nombre == "Jefe Administrativo Financiero Corporativo"
    assert not Cargo.objects.filter(nombre="Jefe de Finanzas y Administración").exists()


def test_sin_gerente_general_no_hace_nada(db):
    assert _como_la_migracion() == []
    assert not UnidadOrganizacional.objects.filter(nombre="Directorio").exists()
