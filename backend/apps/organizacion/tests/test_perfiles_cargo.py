"""El perfil de cada cargo (20/10/2026): objetivo, funciones, competencias y
KPIs.

Lo que se protege: solo lo escribe quien tiene `institucional.perfil_cargo`;
quien ocupa el cargo lo ve en «Mi perfil» en cuanto lo elige o se lo asignan;
las listas se guardan una por línea y se entregan limpias; el organigrama dice
si cada cargo tiene su perfil completo, a medias o vacío.
"""

from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.organizacion.models import Cargo, NivelJerarquico, UnidadOrganizacional
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/organizacion/"

PERFIL = {
    "objetivo": "Asegurar la cobranza oportuna de la cartera asignada.",
    "funciones": "Gestionar la cartera vencida\n- Negociar acuerdos de pago\n\n• Reportar a su jefe",
    "competencias": "Negociación\nOrientación a resultados",
    "kpis": "Recuperación de cartera ≥ 90 %\nDías de mora promedio < 30",
}


def _cargo():
    with usando_empresa(empresa_actual()):
        nivel = NivelJerarquico.objects.create(nombre="Área", orden=1)
        unidad = UnidadOrganizacional.objects.create(nombre="Cartera", nivel=nivel)
        return Cargo.objects.create(nombre="Gestor de cobranzas", unidad=unidad, plazas=3)


def test_solo_quien_tiene_el_permiso_escribe_el_perfil(db):
    cargo = _cargo()
    _, rrhh = _cuenta("tatiana", "institucional.perfil_cargo")
    _, arma = _cuenta("ines", "institucional.editar")
    url = f"{BASE}cargos/{cargo.id}/perfil/"
    assert arma.put(url, PERFIL, format="json").status_code == 403
    assert arma.get(url).status_code == 200  # leerlo sí

    respuesta = rrhh.put(url, PERFIL, format="json")
    assert respuesta.status_code == 200, respuesta.data
    datos = respuesta.json()
    assert datos["objetivo"] == PERFIL["objetivo"]
    # Una por línea, sin viñetas ni líneas vacías.
    assert datos["funciones"] == [
        "Gestionar la cartera vencida",
        "Negociar acuerdos de pago",
        "Reportar a su jefe",
    ]
    assert datos["kpis"] == ["Recuperación de cartera ≥ 90 %", "Días de mora promedio < 30"]
    assert datos["completo"] is True

    organigrama = rrhh.get(f"{BASE}organigrama/").json()
    assert organigrama["cargos"][0]["perfil"] == "completo"


def test_quien_ocupa_el_cargo_lo_ve_en_mi_perfil(db):
    cargo = _cargo()
    _, rrhh = _cuenta("tatiana", "institucional.perfil_cargo")
    rrhh.put(f"{BASE}cargos/{cargo.id}/perfil/", {"objetivo": "Cobrar"}, format="json")
    usuario, rosa = _cuenta("rosa")
    assert rosa.get(f"{BASE}mis-datos/").json()["cargo_perfil"] is None

    from apps.organizacion import organigrama

    with usando_empresa(empresa_actual()):
        organigrama.asignar(usuario, cargo)
    perfil = rosa.get(f"{BASE}mis-datos/").json()["cargo_perfil"]
    assert perfil["cargo"] == {"id": cargo.id, "nombre": "Gestor de cobranzas"}
    assert perfil["objetivo"] == "Cobrar"
    assert perfil["funciones"] == [] and perfil["completo"] is False
    # Sin permisos para ver el organigrama, no lee perfiles de otros cargos.
    assert rosa.get(f"{BASE}cargos/{cargo.id}/perfil/").status_code == 403


def test_en_el_perfil_del_cargo_se_marcan_sus_herramientas(db):
    cargo = _cargo()
    _, rrhh = _cuenta("tatiana", "institucional.perfil_cargo", "herramientas.gestionar")
    claude = rrhh.post(f"{BASE}herramientas/", {"nombre": "Claude"}, format="json").json()["id"]
    zimbra = rrhh.post(
        f"{BASE}herramientas/", {"nombre": "Zimbra", "tipo": "interna"}, format="json"
    ).json()["id"]
    url = f"{BASE}cargos/{cargo.id}/perfil/"
    assert rrhh.get(url).json()["herramientas"] == []
    guardado = rrhh.put(url, {**PERFIL, "herramientas": [zimbra, claude]}, format="json").json()
    assert guardado["herramientas"] == sorted([claude, zimbra])
    # Sin el campo, las herramientas no se tocan.
    sin = rrhh.put(url, {"objetivo": "Otro"}, format="json").json()
    assert sin["herramientas"] == sorted([claude, zimbra])
    assert rrhh.put(url, {"herramientas": [99999]}, format="json").status_code == 400
