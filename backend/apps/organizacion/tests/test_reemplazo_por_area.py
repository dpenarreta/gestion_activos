"""Quien aprueba por otra persona mientras no está: solo alguien de su
misma área o su jefe directo (17/11/2026, decisión del usuario)."""

import pytest

from apps.licencias.tests.test_licencias import empresa_con_organigrama  # noqa: F401
from apps.organizacion.models import DatosDeContacto, Departamento

URL = "/api/v1/organizacion/mi-reemplazo/"


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811
    """Ana y Julia (su jefa) en Cobranzas; Tatiana en Talento Humano;
    Gerardo, sin área."""
    cobranzas = Departamento.objects.create(nombre="Cobranzas", codigo="COB")
    th = Departamento.objects.create(nombre="Talento Humano", codigo="TH")
    for clave, area in (("ana", cobranzas), ("jefa", cobranzas), ("th", th)):
        DatosDeContacto.objects.update_or_create(
            usuario=empresa_con_organigrama[clave][0], defaults={"departamento": area}
        )
    return empresa_con_organigrama


def test_no_se_elige_a_alguien_de_otra_area(e):
    tatiana = e["th"][0]
    _, cliente = e["ana"]
    respuesta = cliente.put(URL, {"modo": "persona", "persona_id": tatiana.pk}, format="json")
    assert respuesta.status_code == 400
    assert "misma área o a su jefe directo" in str(respuesta.json())


def test_se_elige_a_alguien_de_la_misma_area_o_al_jefe_directo(e):
    julia = e["jefa"][0]
    _, cliente = e["ana"]
    respuesta = cliente.put(URL, {"modo": "persona", "persona_id": julia.pk}, format="json")
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["persona"]["id"] == julia.pk


def test_los_candidatos_son_su_area_y_su_jefe(e):
    julia = e["jefa"][0]
    _, cliente = e["ana"]
    candidatos = cliente.get(f"{URL}candidatos/").json()
    assert [c["id"] for c in candidatos] == [julia.pk]
    assert candidatos[0]["es_jefe"] is True
    assert cliente.get(f"{URL}candidatos/", {"q": "zzz"}).json() == []
