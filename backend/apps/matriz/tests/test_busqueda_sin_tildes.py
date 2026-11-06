"""La Matriz de obligaciones se busca sin tildes ni mayúsculas, cada palabra
en cualquier orden (ver `apps.core.busqueda`)."""

import pytest

from .test_fase2_obligaciones import (  # noqa: F401 (fixtures)
    _alta,
    _cliente,
    courier,
    gente,
    seguridad,
)

pytestmark = pytest.mark.django_db


def _buscar(cliente, termino):
    respuesta = cliente.get("/api/v1/matriz/periodos/", {"q": termino})
    assert respuesta.status_code == 200
    return [fila["obligacion"]["nombre"] for fila in respuesta.data["results"]]


def test_declaracion_encuentra_la_declaracion_con_tilde(gente, courier):  # noqa: F811
    admin = _cliente(gente["admin"], courier)
    for nombre in ("Declaración de retención en la fuente", "Pago de patente municipal"):
        alta = _alta(admin, nombre=nombre, responsable=gente["ana"].id)
        assert alta.status_code == 201, alta.data

    assert _buscar(admin, "declaracion") == ["Declaración de retención en la fuente"]
    assert _buscar(admin, "RETENCIÓN") == ["Declaración de retención en la fuente"]
    # Palabras en cualquier orden, entre el nombre y la entidad (SRI).
    assert _buscar(admin, "sri retencion") == ["Declaración de retención en la fuente"]
    assert _buscar(admin, "retencion patente") == []
