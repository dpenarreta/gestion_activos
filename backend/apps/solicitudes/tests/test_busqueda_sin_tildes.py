"""Las solicitudes se buscan sin tildes ni mayúsculas, cada palabra en
cualquier orden (ver `apps.core.busqueda`)."""

from .conftest import RUTA, _cliente, _crear


def _buscar(usuario, empresa, termino):
    respuesta = _cliente(usuario, empresa).get(RUTA, {"q": termino})
    assert respuesta.status_code == 200
    return [fila["detalle"] for fila in respuesta.data["results"]]


def test_sin_tildes_ni_mayusculas(pide, compra, empresa):
    _crear(pide, compra, empresa, detalle="Batería para la laptop de Ñandú")
    _crear(pide, compra, empresa, detalle="Monitor curvo")

    assert _buscar(pide, empresa, "bateria") == ["Batería para la laptop de Ñandú"]
    assert _buscar(pide, empresa, "NANDU") == ["Batería para la laptop de Ñandú"]


def test_cada_palabra_en_cualquier_orden_y_entre_campos(pide, compra, empresa):
    _crear(pide, compra, empresa, detalle="Batería para la laptop")
    _crear(pide, compra, empresa, detalle="Monitor curvo")

    # «perez» está en el apellido de quien pide (Pérez) y «bateria» en el detalle.
    assert _buscar(pide, empresa, "perez bateria") == ["Batería para la laptop"]
    assert _buscar(pide, empresa, "bateria monitor") == []
