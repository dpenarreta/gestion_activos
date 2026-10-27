"""El organigrama «Gestión de Talento Humano LCE 2026» (27/10/2026).

Los cargos de Gestión Humana se renombran y conservan su rol y sus permisos;
el Gerente Gestión Humana reporta al Gerente General; entran las personas
nuevas y el cambio queda en la bitácora. Repetirlo no cambia nada.
"""

from apps.organizacion import talento_humano_2026
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
    gh = UnidadOrganizacional.objects.create(
        nombre="Gestión Humana y Seguridad Ocupacional", nivel=nivel, padre=general
    )
    cargos = {}

    def cargo(nombre, jefe=None, unidad=gh, **extra):
        cargos[nombre] = Cargo.objects.create(
            nombre=nombre, unidad=unidad, jefe=cargos.get(jefe), **extra
        )
        asegurar_rol(cargos[nombre])

    cargo("Gerente General", unidad=general)
    cargo("Gerenta de GGHH", "Gerente General")
    cargo("Jefe de GGH y SSO", "Gerenta de GGHH")
    cargo("Salud Ocupacional", "Jefe de GGH y SSO")
    cargo("Coordinador Nacional de GGHH", "Jefe de GGH y SSO")
    cargo("Reclutamiento y Selección", "Coordinador Nacional de GGHH")
    cargo("Desarrollo y Capacitación de Personal", "Coordinador Nacional de GGHH")
    cargo("Asistente de GGHH", "Reclutamiento y Selección")
    cargo("Coordinador Zona Sur", "Coordinador Nacional de GGHH")
    cargo("Asistente Zona Sur", "Coordinador Zona Sur")
    cargo("Jefe de Nómina", "Coordinador Nacional de GGHH")
    cargo("Pasante de GGHH", "Coordinador Zona Sur")
    OcupanteCargo.objects.create(
        cargo=cargos["Asistente de GGHH"], nombres="Melanie Andrea", apellidos="Bermello Marcillo"
    )
    return gh, cargos


def _permisos(cargo):
    cargo.refresh_from_db()
    return set(cargo.rol.permissions.values_list("codename", flat=True))


def test_renombra_los_cargos_y_conservan_rol_y_permisos(db):
    gh, cargos = _area_como_estaba()
    clima = cargos["Desarrollo y Capacitación de Personal"]
    rol_antes = clima.rol_id

    lineas = talento_humano_2026.aplicar()

    assert lineas
    gh.refresh_from_db()
    assert gh.nombre == "Gestión de Talento Humano"
    clima.refresh_from_db()
    assert clima.nombre == "Analista Clima y Cultura" and clima.rol_id == rol_antes
    assert clima.rol.name == "Analista Clima y Cultura"
    # Sigue con lo que tenía: noticias, códigos de conducta, la estructura.
    assert {"noticias.gestionar", "codigos.publicar", "institucional.editar"} <= _permisos(clima)
    jefe = Cargo.objects.get(pk=cargos["Jefe de GGH y SSO"].pk)
    assert jefe.nombre == "Jefe Nacional de Talento Humano y SSO"
    assert "institucional.editar" in _permisos(jefe)
    asistente_sur = Cargo.objects.get(pk=cargos["Asistente Zona Sur"].pk)
    assert asistente_sur.nombre == "Asistente Gestión Humana Zona Sur"
    assert "roles_pago.historial" in _permisos(asistente_sur)


def test_jefes_personas_y_bitacora(db):
    _, cargos = _area_como_estaba()

    talento_humano_2026.aplicar()

    gerente = Cargo.objects.get(pk=cargos["Gerenta de GGHH"].pk)
    assert gerente.nombre == "Gerente Gestión Humana"
    assert gerente.jefe == cargos["Gerente General"]
    assert [str(o) for o in gerente.ocupantes_sin_cuenta.all()] == ["Cristina Granda"]
    asistente = Cargo.objects.get(pk=cargos["Asistente de GGHH"].pk)
    assert asistente.plazas == 2
    assert asistente.jefe.nombre == "Analista de Selección"
    assert sorted(str(o) for o in asistente.ocupantes_sin_cuenta.all()) == [
        "Farid Maldonado",
        "Melanie Andrea Bermello Marcillo",
    ]
    assert Cargo.objects.get(pk=cargos["Salud Ocupacional"].pk).plazas == 2
    # El pasante no está en el organigrama nuevo y nadie lo ocupaba.
    assert Cargo.objects.get(pk=cargos["Pasante de GGHH"].pk).activo is False

    (version,) = VersionOrganigrama.objects.all()
    assert version.usuario is None and "LCE 2026" in version.motivo
    assert "Gerenta de GGHH" in [c["nombre"] for c in version.respaldo["cargos"]]


def test_repetirlo_no_cambia_nada(db):
    _area_como_estaba()
    talento_humano_2026.aplicar()

    assert talento_humano_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == 1
    assert OcupanteCargo.objects.filter(nombres="Farid").count() == 1


def test_sin_la_unidad_no_hace_nada(db):
    assert talento_humano_2026.aplicar() == []
    assert not VersionOrganigrama.objects.exists()
