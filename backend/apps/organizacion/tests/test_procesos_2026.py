"""El organigrama de Procesos y Proyectos (27/10/2026): el Gerente de Procesos
y Proyectos reporta al Gerente General y el Jefe de Procesos, a él."""

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


def test_gerente_al_gerente_general_y_jefe_al_gerente(db):
    procesos, gg, gerente, jefe, analista = _area_como_estaba()

    assert procesos_2026.aplicar()

    gerente.refresh_from_db()
    assert gerente.activo is True and gerente.jefe == gg
    jefe.refresh_from_db()
    assert jefe.jefe == gerente
    analista.refresh_from_db()
    assert analista.nombre == "Analista de Procesos y Mejora Continua"
    activos = set(
        Cargo.objects.filter(unidad=procesos, activo=True).values_list("nombre", flat=True)
    )
    assert activos == {
        "Gerente de Procesos y Proyectos",
        "Jefe de Procesos y Mejora Continua",
        "Analista de Procesos y Mejora Continua",
        "Asistente de Procesos y Mejora Continua",
        "Auditor de Procesos Zona Norte",
        "Auditor de Procesos Zona Sur",
    }
    assert procesos_2026.aplicar() == []


def test_corrige_la_version_que_colgo_al_jefe_del_gerente_general(db):
    _, gg, gerente, jefe, _ = _area_como_estaba()
    Cargo.objects.filter(pk=jefe.pk).update(jefe=gg)
    Cargo.objects.filter(pk=gerente.pk).update(activo=False)

    procesos_2026.aplicar()

    gerente.refresh_from_db()
    jefe.refresh_from_db()
    assert gerente.activo is True and jefe.jefe == gerente


def test_sin_las_areas_se_crean_bajo_la_gerencia_general(db):
    """Producción (27/10/2026): solo estaban la Gerencia General y Tecnología."""
    from apps.organizacion import laarbox_2026, talento_humano_2026

    nivel_gg = NivelJerarquico.objects.create(nombre="Gerencia General", orden=1)
    nivel_area = NivelJerarquico.objects.create(nombre="Departamento", orden=2)
    general = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel_gg)
    UnidadOrganizacional.objects.create(
        nombre="Innovación y Transformación Digital", nivel=nivel_area, padre=general
    )
    gg = Cargo.objects.create(nombre="Gerente General", unidad=general)

    talento_humano_2026.aplicar()
    laarbox_2026.aplicar()
    procesos_2026.aplicar()

    for nombre in ("Gestión de Talento Humano", "Producto Laarbox", "Procesos y Proyectos"):
        unidad = UnidadOrganizacional.objects.get(nombre=nombre)
        assert unidad.padre == general and unidad.nivel == nivel_area
        assert unidad.departamento is not None
    assert Cargo.objects.get(nombre="Gerente Gestión Humana").jefe == gg
    assert Cargo.objects.get(nombre="Jefe de Producto Laarbox").jefe == gg
    gerente = Cargo.objects.get(nombre="Gerente de Procesos y Proyectos")
    assert gerente.jefe == gg
    assert Cargo.objects.get(nombre="Jefe de Procesos y Mejora Continua").jefe == gerente
    gh = UnidadOrganizacional.objects.get(nombre="Gestión de Talento Humano")
    assert Cargo.objects.filter(unidad=gh, activo=True).count() == 13
    assert OcupanteCargo.objects.filter(cargo__unidad=gh).count() == 15
    clima = Cargo.objects.get(nombre="Analista Clima y Cultura")
    assert "noticias.gestionar" in set(clima.rol.permissions.values_list("codename", flat=True))
    # Repetirlo no cambia nada.
    assert talento_humano_2026.aplicar() == []
    assert laarbox_2026.aplicar() == []
    assert procesos_2026.aplicar() == []
