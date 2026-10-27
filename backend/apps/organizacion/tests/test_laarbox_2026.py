"""El organigrama del área LaarBox (27/10/2026).

Los cargos de antes se reconocen por nombre y jefe y se renombran (conservan
su rol y quienes los ocupan), los nuevos se crean, y los que ya no están se
desactivan solo si nadie los ocupa. Repetirlo no cambia nada.
"""

from apps.organizacion import laarbox_2026
from apps.organizacion.models import (
    Cargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.roles_de_cargo import asegurar_rol


def _area_como_estaba():
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
    laarbox = UnidadOrganizacional.objects.create(
        nombre="Producto Laarbox", nivel=nivel, padre=general
    )
    cargos = {}

    def cargo(clave, nombre, jefe=None, unidad=laarbox, plazas=1):
        cargos[clave] = Cargo.objects.create(
            nombre=nombre, unidad=unidad, jefe=cargos.get(jefe), plazas=plazas
        )
        asegurar_rol(cargos[clave])

    cargo("general", "Gerente General", unidad=general)
    cargo("jefe", "Jefe de Producto Laarbox", "general")
    cargo("coordinador", "Coordinador de Aduana", "jefe")
    cargo("operaciones_aduana", "Supervisor de Operaciones", "coordinador")
    cargo("facturas", "Auxiliar de Facturas", "operaciones_aduana")
    cargo("temu", "Declarante Temu", "operaciones_aduana", plazas=3)
    cargo("laarbox", "Declarante Laarbox", "operaciones_aduana", plazas=2)
    cargo("sac", "Supervisor SAC", "jefe")
    cargo("asistente_sac", "Asistente Servicio al Cliente", "sac", plazas=5)
    cargo("aduana", "Supervisor de Aduana", "jefe")
    cargo("auxiliar_aduana", "Auxiliar de Aduana", "aduana", plazas=3)
    cargo("operaciones", "Supervisor de Operaciones", "jefe")
    cargo("auxiliar_operaciones", "Auxiliar de Operaciones", "operaciones")
    cargo("mecanizacion", "Auxiliar de Mecanización", "auxiliar_operaciones", plazas=21)
    cargo("carga", "Supervisor de Operaciones Carga", "jefe")
    # Alguien ya ocupa un cargo que no está en el organigrama nuevo.
    OcupanteCargo.objects.create(cargo=cargos["carga"], nombres="Ana", apellidos="Prueba")
    return laarbox, cargos


def _activos(unidad):
    return {
        (c.nombre, c.jefe.nombre if c.jefe_id else None): c
        for c in Cargo.objects.filter(unidad=unidad, activo=True).select_related("jefe")
    }


def test_queda_como_el_organigrama(db):
    laarbox, cargos = _area_como_estaba()
    rol_comex = cargos["operaciones_aduana"].rol_id

    lineas = laarbox_2026.aplicar()

    assert lineas
    activos = _activos(laarbox)
    comex = activos[("Supervisor COMEX", "Coordinador de Aduana")]
    # Es el Supervisor de Operaciones del coordinador, renombrado.
    assert comex.id == cargos["operaciones_aduana"].id and comex.rol_id == rol_comex
    assert activos[("Supervisor de Bodega", "Jefe de Producto Laarbox")].id == (
        cargos["operaciones"].id
    )
    mecanizador = activos[("Mecanizador", "Supervisor de Bodega")]
    assert mecanizador.id == cargos["mecanizacion"].id and mecanizador.plazas == 22
    declarante = activos[("Declarante de Aduana", "Supervisor COMEX")]
    assert declarante.id == cargos["laarbox"].id
    assert sorted(str(o) for o in declarante.ocupantes_sin_cuenta.all()) == [
        "Kathy Nicolalde",
        "Shelleny Avellan",
    ]
    temu = activos[("Declarante de Aduana", "Supervisor COMEX Temu")]
    assert temu.id == cargos["temu"].id and temu.plazas == 2
    assert ("Analista Operativo COMEX", "Declarante de Aduana") in activos
    for nuevo in ("Supervisor Régimen Consumo", "Supervisor de Almacenaje"):
        assert (nuevo, "Jefe de Producto Laarbox") in activos
    jefe = activos[("Jefe de Producto Laarbox", "Gerente General")]
    assert [str(o) for o in jefe.ocupantes_sin_cuenta.all()] == ["Xavier Ullauri"]
    # Los dos declarantes se llaman igual: sus roles se distinguen.
    assert declarante.rol.name != temu.rol.name

    # Lo que ya no está y nadie ocupa, inactivo; lo ocupado se queda.
    for clave in ("facturas", "sac", "asistente_sac", "auxiliar_operaciones"):
        assert Cargo.objects.get(pk=cargos[clave].pk).activo is False
    assert Cargo.objects.get(pk=cargos["carga"].pk).activo is True

    (version,) = VersionOrganigrama.objects.all()
    assert version.usuario is None and "LaarBox" in version.motivo


def test_repetirlo_no_cambia_nada(db):
    _area_como_estaba()
    laarbox_2026.aplicar()

    assert laarbox_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == 1
    assert OcupanteCargo.objects.filter(nombres="Gary", apellidos="Bravo").count() == 1


def test_sin_la_unidad_no_hace_nada(db):
    assert laarbox_2026.aplicar() == []
    assert not VersionOrganigrama.objects.exists()
