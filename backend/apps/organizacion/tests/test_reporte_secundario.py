"""El reporte secundario de los cargos: la «línea punteada» (09/11/2026).

Un cargo reporta a su jefe inmediato y, además, puede reportar a otros cargos
(`Cargo.jefes_secundarios`). Lo que se protege: quién puede editarlo, las
validaciones (ni él mismo, ni su jefe inmediato, ni círculos, ni otra
empresa; sin regla de niveles), que quede en la bitácora y se revierta, que
el jefe secundario vea esa rama en el organigrama de su área, y la migración
que lo asigna a Cartera y a Gestión Humana (idempotente).
"""

import importlib

import pytest

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa
from apps.organizacion import reporte_secundario_2026, reportes, versiones
from apps.organizacion.models import (
    Cargo,
    DatosDeContacto,
    NivelCargo,
    NivelJerarquico,
    UnidadOrganizacional,
    VersionOrganigrama,
)
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/organizacion/"
migracion = importlib.import_module("apps.organizacion.migrations.0046_reporte_secundario_2026")


def _estructura():
    """Gerencia General › Financiero Administrativo (Jefe Financiero) ›
    Cartera (Jefe de Cartera › Asistente) y Gestión de Talento Humano
    (Gerente › Jefe de Nómina). Cartera y Talento Humano reportan al Gerente
    General."""
    alta = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
    depto = NivelJerarquico.objects.create(nombre="Departamento", orden=2)
    area = NivelJerarquico.objects.create(nombre="Área", orden=3)
    gg = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=alta)
    fin = UnidadOrganizacional.objects.create(
        nombre="Financiero Administrativo", nivel=depto, padre=gg
    )
    cartera = UnidadOrganizacional.objects.create(nombre="Cartera", nivel=area, padre=fin)
    th = UnidadOrganizacional.objects.create(
        nombre="Gestión de Talento Humano", nivel=area, padre=gg
    )
    comercial = UnidadOrganizacional.objects.create(nombre="Comercial", nivel=depto, padre=gg)
    gerente = Cargo.objects.create(
        nombre="Gerente General", unidad=gg, nivel=NivelCargo.GERENCIA_GENERAL
    )
    jefe_fin = Cargo.objects.create(
        nombre="Jefe Financiero Administrativo",
        unidad=fin,
        jefe=gerente,
        nivel=NivelCargo.JEFATURA,
    )
    jefe_cartera = Cargo.objects.create(
        nombre="Jefe de Cartera", unidad=cartera, jefe=gerente, nivel=NivelCargo.JEFATURA
    )
    asistente = Cargo.objects.create(
        nombre="Asistente de Cartera", unidad=cartera, jefe=jefe_cartera, nivel="asistente"
    )
    gerente_th = Cargo.objects.create(
        nombre="Gerente Gestión Humana", unidad=th, jefe=gerente, nivel=NivelCargo.GERENCIA_AREA
    )
    nomina = Cargo.objects.create(
        nombre="Jefe de Nómina", unidad=th, jefe=gerente_th, nivel=NivelCargo.JEFATURA
    )
    vendedor = Cargo.objects.create(nombre="Vendedor", unidad=comercial, jefe=gerente)
    return {
        "gerente": gerente,
        "jefe_fin": jefe_fin,
        "jefe_cartera": jefe_cartera,
        "asistente": asistente,
        "gerente_th": gerente_th,
        "nomina": nomina,
        "vendedor": vendedor,
        "fin": fin,
    }


def _editor():
    return _cuenta(
        "editora", "institucional.ver", "institucional.ver_todo", "institucional.editar"
    )[1]


def _patch(cliente, cargo, **datos):
    return cliente.patch(f"{BASE}cargos/{cargo.id}/", datos, format="json")


def _error(respuesta, campo="jefes_secundarios"):
    return str(respuesta.data["error"]["details"][campo])


# --- API ---------------------------------------------------------------------------


def test_se_asigna_por_la_api_y_se_lee_con_sus_nombres(db):
    e = _estructura()
    cliente = _editor()
    respuesta = _patch(cliente, e["jefe_cartera"], jefes_secundarios=[e["jefe_fin"].id])
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.data["jefes_secundarios"] == [e["jefe_fin"].id]
    assert respuesta.data["jefes_secundarios_detalle"] == [
        {"id": e["jefe_fin"].id, "nombre": "Jefe Financiero Administrativo"}
    ]
    # El jefe inmediato no cambia.
    e["jefe_cartera"].refresh_from_db()
    assert e["jefe_cartera"].jefe_id == e["gerente"].id
    # El organigrama lo trae para la Estructura y el dibujo.
    arbol = cliente.get(f"{BASE}organigrama/").json()
    por_nombre = {c["nombre"]: c for c in arbol["cargos"]}
    assert por_nombre["Jefe de Cartera"]["jefes_secundarios"] == [e["jefe_fin"].id]
    assert por_nombre["Asistente de Cartera"]["jefes_secundarios"] == []
    # Y se quita con la lista vacía.
    respuesta = _patch(cliente, e["jefe_cartera"], jefes_secundarios=[])
    assert respuesta.status_code == 200 and respuesta.data["jefes_secundarios"] == []


def test_editar_otro_campo_conserva_el_reporte_secundario(db):
    e = _estructura()
    e["jefe_cartera"].jefes_secundarios.add(e["jefe_fin"])
    respuesta = _patch(_editor(), e["jefe_cartera"], plazas=2)
    assert respuesta.status_code == 200
    assert respuesta.data["jefes_secundarios"] == [e["jefe_fin"].id]


def test_solo_quien_edita_cargos_lo_cambia(db):
    e = _estructura()
    _, cliente = _cuenta("lectora", "institucional.ver")
    respuesta = _patch(cliente, e["jefe_cartera"], jefes_secundarios=[e["jefe_fin"].id])
    assert respuesta.status_code == 403
    assert not e["jefe_cartera"].jefes_secundarios.exists()


def test_al_crear_un_cargo_se_puede_indicar(db):
    e = _estructura()
    respuesta = _editor().post(
        f"{BASE}cargos/",
        {
            "nombre": "Analista de Cobranza",
            "unidad": e["fin"].id,
            "jefe": e["jefe_cartera"].id,
            "jefes_secundarios": [e["jefe_fin"].id],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    assert Cargo.objects.get(pk=respuesta.data["id"]).jefes_secundarios.get() == e["jefe_fin"]


# --- Validaciones --------------------------------------------------------------------


def test_no_reporta_tambien_a_si_mismo(db):
    e = _estructura()
    respuesta = _patch(_editor(), e["jefe_cartera"], jefes_secundarios=[e["jefe_cartera"].id])
    assert respuesta.status_code == 400 and "a sí mismo" in _error(respuesta)


def test_su_jefe_inmediato_no_es_ademas_jefe_secundario(db):
    e = _estructura()
    cliente = _editor()
    respuesta = _patch(cliente, e["jefe_cartera"], jefes_secundarios=[e["gerente"].id])
    assert respuesta.status_code == 400 and "ya es su jefe inmediato" in _error(respuesta)
    # Tampoco al cambiar el jefe a quien ya era jefe secundario.
    e["jefe_cartera"].jefes_secundarios.add(e["jefe_fin"])
    respuesta = _patch(cliente, e["jefe_cartera"], jefe=e["jefe_fin"].id)
    assert respuesta.status_code == 400 and "ya es su jefe inmediato" in _error(respuesta)


def test_no_se_cierran_circulos_entre_las_dos_lineas(db):
    e = _estructura()
    cliente = _editor()
    # El Jefe de Cartera no reporta también a su propia asistente.
    respuesta = _patch(cliente, e["jefe_cartera"], jefes_secundarios=[e["asistente"].id])
    assert respuesta.status_code == 400 and "depende de este cargo" in _error(respuesta)
    # Con la línea punteada Cartera → Financiero, el Jefe Financiero no puede
    # tomar como jefe inmediato a la asistente de Cartera…
    e["jefe_cartera"].jefes_secundarios.add(e["jefe_fin"])
    respuesta = _patch(cliente, e["jefe_fin"], jefe=e["asistente"].id)
    assert respuesta.status_code == 400 and "depende de él" in _error(respuesta, "jefe")
    # …ni reportarle en línea punteada.
    respuesta = _patch(cliente, e["jefe_fin"], jefes_secundarios=[e["asistente"].id])
    assert respuesta.status_code == 400 and "depende de este cargo" in _error(respuesta)


def test_no_tiene_la_regla_de_niveles_del_jefe_inmediato(db):
    """La Gerente de Gestión Humana (Gerencia de Área) reporta también a una
    Jefatura: lo pidió el usuario, y la regla de niveles es solo del jefe."""
    e = _estructura()
    respuesta = _patch(_editor(), e["gerente_th"], jefes_secundarios=[e["jefe_fin"].id])
    assert respuesta.status_code == 200, respuesta.data


def test_un_cargo_de_otra_empresa_no_sirve(db):
    e = _estructura()
    otra = Empresa.objects.create(nombre="Otra empresa", codigo="OTR")
    with usando_empresa(otra):
        ajeno = Cargo.objects.create(nombre="Jefe Financiero Administrativo")
    respuesta = _patch(_editor(), e["jefe_cartera"], jefes_secundarios=[ajeno.id])
    assert respuesta.status_code == 400
    assert not e["jefe_cartera"].jefes_secundarios.exists()
    # Y la regla, por si se llama sin pasar por la API.
    with pytest.raises(Exception, match="otra empresa"):
        reportes.validar(e["jefe_cartera"], e["gerente"], [ajeno])


# --- Bitácora -------------------------------------------------------------------------


def test_queda_en_la_bitacora_y_se_revierte(db):
    e = _estructura()
    cliente = _editor()
    _patch(cliente, e["jefe_cartera"], jefes_secundarios=[e["jefe_fin"].id])
    version = VersionOrganigrama.objects.order_by("-id").first()
    assert version.cambios == [
        "Cargo «Jefe de Cartera»: también reporta a: — → Jefe Financiero Administrativo."
    ]
    assert cliente.post(f"{BASE}organigrama/versiones/{version.id}/revertir/").status_code in (
        200,
        201,
    )
    assert not e["jefe_cartera"].jefes_secundarios.exists()


def test_un_respaldo_de_antes_no_trae_el_campo_y_no_cuenta_como_cambio(db):
    _estructura()
    antes = versiones.foto()
    for cargo in antes["cargos"]:
        del cargo["jefes_secundarios"]
    assert versiones.diferencias(antes, versiones.foto()) == []


# --- Organigrama de su área -------------------------------------------------------------


def test_el_jefe_secundario_ve_esa_rama_en_el_organigrama_de_su_area(db):
    e = _estructura()
    # Talento Humano no cuelga de Financiero: solo la línea punteada la trae.
    e["gerente_th"].jefes_secundarios.add(e["jefe_fin"])
    christian, cliente = _cuenta("christian", "institucional.ver_area")
    DatosDeContacto.objects.create(usuario=christian, cargo=e["jefe_fin"])
    datos = cliente.get(f"{BASE}organigrama/").json()
    cargos = {c["nombre"] for c in datos["cargos"]}
    assert {"Gerente Gestión Humana", "Jefe de Nómina"} <= cargos
    assert "Gestión de Talento Humano" in {u["nombre"] for u in datos["unidades"]}
    # Lo demás de la empresa no sale.
    assert "Vendedor" not in cargos and "Gerente General" not in cargos


# --- La migración ------------------------------------------------------------------------


def test_la_migracion_asigna_cartera_y_gestion_humana_y_es_idempotente(db):
    e = _estructura()
    lineas = reporte_secundario_2026.aplicar()
    assert sorted(lineas) == [
        "Cargo «Gerente Gestión Humana»: también reporta a: — → Jefe Financiero Administrativo.",
        "Cargo «Jefe de Cartera»: también reporta a: — → Jefe Financiero Administrativo.",
    ]
    for cargo in (e["jefe_cartera"], e["gerente_th"]):
        assert list(cargo.jefes_secundarios.all()) == [e["jefe_fin"]]
        cargo.refresh_from_db()
        assert cargo.jefe_id == e["gerente"].id
    # El Jefe de Nómina (no es el más alto del área) no lo recibe.
    assert not e["nomina"].jefes_secundarios.exists()
    version = VersionOrganigrama.objects.get()
    assert version.motivo == reporte_secundario_2026.MOTIVO and version.usuario is None
    # Repetirlo no cambia nada ni deja otra versión.
    assert reporte_secundario_2026.aplicar() == []
    assert VersionOrganigrama.objects.count() == 1


def test_la_migracion_sin_los_cargos_no_hace_nada(db):
    _estructura()
    Cargo.objects.filter(nombre="Jefe Financiero Administrativo").update(activo=False)
    assert reporte_secundario_2026.aplicar() == []
    assert not Cargo.jefes_secundarios.through.objects.exists()


def test_la_migracion_corre_por_empresa(db):
    e = _estructura()
    migracion.aplicar(None, None)
    assert e["jefe_cartera"].jefes_secundarios.get() == e["jefe_fin"]
