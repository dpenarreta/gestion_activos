"""Las órdenes de trabajo se buscan sin tildes ni mayúsculas, cada palabra en
cualquier orden (ver `apps.core.busqueda`)."""

import pytest

from .test_ordenes import BASE, _cliente, _crear, escenario  # noqa: F401 (fixture)

pytestmark = pytest.mark.django_db


def _buscar(cliente, termino):
    respuesta = cliente.get(BASE, {"q": termino})
    assert respuesta.status_code == 200
    return [fila["titulo"] for fila in respuesta.data["results"]]


def test_caida_encuentra_la_orden_escrita_con_tilde(escenario):  # noqa: F811
    cliente = _cliente(escenario["coordinador"])
    _crear(cliente, escenario["quito"], titulo="Caída del cielo raso en bodega")
    _crear(cliente, escenario["manta"], titulo="Sin luz en el área de cajas")

    assert _buscar(cliente, "caida") == ["Caída del cielo raso en bodega"]
    # Varias palabras en cualquier orden, entre el título y la sede.
    assert _buscar(cliente, "QUITO bodega") == ["Caída del cielo raso en bodega"]
    assert _buscar(cliente, "area manta") == ["Sin luz en el área de cajas"]


def test_el_numero_se_sigue_buscando_entero(escenario):  # noqa: F811
    cliente = _cliente(escenario["coordinador"])
    orden = _crear(cliente, escenario["quito"], titulo="Caída del cielo raso")
    _crear(cliente, escenario["manta"])

    assert _buscar(cliente, orden["numero"]) == ["Caída del cielo raso"]
