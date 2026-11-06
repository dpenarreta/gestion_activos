"""La lista de habilitados del rol de pagos se busca sin tildes ni mayúsculas,
cada palabra en cualquier orden (ver `apps.core.busqueda`)."""

import pytest
from django.test import override_settings

from apps.organizacion.tests.test_carga_personas import _cuenta

from .test_habilitados import HABILITADOS


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


def test_habilitados_sin_tildes(db):
    jose, _ = _cuenta("jramirez")
    jose.first_name, jose.last_name = "José", "Ramírez Peña"
    jose.save()
    _cuenta("acevallos")
    _, nomina = _cuenta("nomina", "roles_pago.habilitar")

    def buscar(termino):
        respuesta = nomina.get(HABILITADOS, {"q": termino})
        assert respuesta.status_code == 200
        return [fila["id"] for fila in respuesta.json()]

    assert buscar("ramirez") == [jose.id]
    assert buscar("PENA jose") == [jose.id]
    assert buscar("jose acevallos") == []
