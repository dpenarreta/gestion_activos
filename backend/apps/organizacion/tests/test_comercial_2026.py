"""El organigrama del área Comercial (27/10/2026).

Los equipos de antes se reconocen por nombre y jefe y se renombran
(conservan su rol y quienes los ocupan, y toman el nivel de su nombre
nuevo), los nuevos se crean y los que ya no están se desactivan solo si
nadie los ocupa. Repetirlo no cambia nada.
"""

from apps.organizacion import comercial_2026
from apps.organizacion.models import (
    Cargo,
    NivelCargo,
    NivelJerarquico,
    OcupanteCargo,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.roles_de_cargo import asegurar_rol


def _area_como_estaba():
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
    comercial = UnidadOrganizacional.objects.create(nombre="Comercial", nivel=nivel, padre=general)
    cargos = {}

    def cargo(clave, nombre, jefe=None, unidad=comercial, plazas=1, nivel=NivelCargo.OPERATIVO):
        cargos[clave] = Cargo.objects.create(
            nombre=nombre, unidad=unidad, jefe=cargos.get(jefe), plazas=plazas, nivel=nivel
        )
        asegurar_rol(cargos[clave])

    cargo("general", "Gerente General", unidad=general, nivel=NivelCargo.GERENCIA_GENERAL)
    cargo("gerente", "Gerente Comercial", "general", nivel=NivelCargo.GERENCIA_AREA)
    cargo("coordinador", "Coordinador Comercial", "gerente", nivel=NivelCargo.COORDINACION)
    cargo("asesor_coord", "Asesor Comercial", "coordinador", plazas=5)
    cargo("televendedor", "Televendedor", "coordinador")
    cargo("asistente_coord", "Asistente Comercial", "coordinador", nivel=NivelCargo.ASISTENTE)
    cargo("ventas", "Jefe de Ventas", "gerente", nivel=NivelCargo.JEFATURA)
    cargo("asesor_ventas", "Asesor Comercial", "ventas", plazas=6)
    cargo("asesor_lider", "Asesor Comercial", "gerente")
    cargo("asesor_equipo", "Asesor Comercial", "asesor_lider", plazas=3)
    cargo("televendedor_2", "Televendedor", "asesor_lider")
    cargo("ups", "Asesor Comercial UPS", "gerente", plazas=3)
    cargo("televendedor_ocupado", "Televendedor", "asesor_lider")
    # Alguien ya ocupa un cargo que no está en el organigrama nuevo.
    OcupanteCargo.objects.create(
        cargo=cargos["televendedor_ocupado"], nombres="Ana", apellidos="Prueba"
    )
    return comercial, cargos


def _activos(unidad):
    return {
        (c.nombre, c.jefe.nombre if c.jefe_id else None): c
        for c in Cargo.objects.filter(unidad=unidad, activo=True).select_related("jefe")
    }


def test_queda_como_el_organigrama(db):
    comercial, cargos = _area_como_estaba()
    rol_coordinador = cargos["coordinador"].rol_id

    assert comercial_2026.aplicar()

    activos = _activos(comercial)
    quito = activos[("Jefe Comercial Quito", "Gerente Comercial")]
    # Es el Coordinador Comercial renombrado: conserva su rol y sube de nivel.
    assert quito.id == cargos["coordinador"].id and quito.rol_id == rol_coordinador
    assert quito.nivel == NivelCargo.JEFATURA
    assert [str(o) for o in quito.ocupantes_sin_cuenta.all()] == ["Saida Rodríguez"]
    cuenca = activos[("Jefe Comercial Cuenca", "Gerente Comercial")]
    assert cuenca.id == cargos["asesor_lider"].id and cuenca.nivel == NivelCargo.JEFATURA
    assert activos[("Asesor Comercial", "Jefe Comercial Cuenca")].id == cargos["asesor_equipo"].id
    guayaquil = activos[("Jefe Comercial Guayaquil", "Gerente Comercial")]
    assert guayaquil.id == cargos["ventas"].id
    assert activos[("Asesor Comercial", "Jefe Comercial Guayaquil")].plazas == 5
    assert activos[("Gestora Comercial", "Jefe Comercial Quito")].id == cargos["asistente_coord"].id
    assert activos[("Gestora Comercial", "Jefe Comercial Guayaquil")].plazas == 2

    # Internacional UPS y Televentas reportan directo a la Gerencia.
    ejecutivo = activos[("Ejecutivo de Negocios UPS Quito", "Gerente Comercial")]
    assert ejecutivo.id == cargos["ups"].id and ejecutivo.plazas == 3
    assert ("Ejecutiva de Negocios UPS Guayaquil", "Gerente Comercial") in activos
    asistente = activos[("Asistente Comercial UPS Guayaquil", "Gerente Comercial")]
    assert asistente.nivel == NivelCargo.ASISTENTE
    televentas = activos[("Asesora de Televentas", "Gerente Comercial")]
    assert televentas.id == cargos["televendedor"].id and televentas.plazas == 2

    # Lo que ya no está y nadie ocupa, inactivo; lo ocupado se queda.
    assert Cargo.objects.get(pk=cargos["televendedor_2"].pk).activo is False
    assert Cargo.objects.get(pk=cargos["televendedor_ocupado"].pk).activo is True

    gerente = activos[("Gerente Comercial", "Gerente General")]
    assert [str(o) for o in gerente.ocupantes_sin_cuenta.all()] == ["Stalin Vera"]
    (version,) = VersionOrganigrama.objects.all()
    assert version.usuario is None and "Comercial" in version.motivo


def test_repetirlo_no_cambia_nada(db):
    _area_como_estaba()
    comercial_2026.aplicar()

    assert comercial_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == 1
    assert OcupanteCargo.objects.filter(nombres="Saida", apellidos="Rodríguez").count() == 1


def test_sin_el_area_la_crea_bajo_la_gerencia_general(db):
    nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
    Cargo.objects.create(
        nombre="Gerente General", unidad=general, nivel=NivelCargo.GERENCIA_GENERAL
    )

    comercial_2026.aplicar()

    comercial = UnidadOrganizacional.objects.get(nombre="Comercial")
    assert comercial.padre_id == general.id
    activos = _activos(comercial)
    assert len(activos) == len({(d["nombre"], d["jefe"]) for d in comercial_2026.CARGOS.values()})
    assert ("Gerente Comercial", "Gerente General") in activos
