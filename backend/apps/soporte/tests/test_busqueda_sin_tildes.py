"""La bandeja de la Mesa de ayuda se busca sin tildes ni mayúsculas.

Hallazgo de la auditoría (06/11/2026): «caida» no encontraba «Caída del
sistema…». Ver `apps.core.busqueda`.
"""

from unittest import mock

from apps.soporte import services

from .test_soporte import TICKETS, _crear, _equipo


def _buscar(mesa, termino):
    respuesta = _equipo(mesa["supervisor"]).get(TICKETS, {"ambito": "todos", "q": termino})
    assert respuesta.status_code == 200
    return [fila["numero"] for fila in respuesta.json()["results"]]


def test_caida_encuentra_la_caida_del_sistema(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        caida = _crear(mesa, descripcion="Caída del sistema de facturación en Loja.")
        _crear(mesa, descripcion="La laptop no enciende desde esta mañana.")

    assert _buscar(mesa, "caida") == [caida["numero"]]
    assert _buscar(mesa, "CAÍDA") == [caida["numero"]]
    # Palabras en cualquier orden, entre la descripción y el nombre de quien pide.
    assert _buscar(mesa, "facturacion ordonez") == [caida["numero"]]
    assert _buscar(mesa, "facturacion olvide") == []


def test_tambien_por_el_caso_y_el_numero(mesa):
    with mock.patch.object(services, "repartir", return_value=0):
        olvido = _crear(mesa, caso=mesa["clave"].id, descripcion="No puedo entrar al correo.")
        _crear(mesa)

    assert _buscar(mesa, "olvide clave") == [olvido["numero"]]
    assert _buscar(mesa, olvido["numero"]) == [olvido["numero"]]
