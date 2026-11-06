"""El registro de descargas se busca sin tildes ni mayúsculas, cada palabra en
cualquier orden (ver `apps.core.busqueda`)."""

import pytest

from apps.organizacion.tests.test_carga_personas import _cuenta

from .test_descargas import URL, _guardar


@pytest.fixture(autouse=True)
def _media(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)


def test_por_archivo_y_persona_sin_tildes(db):
    _, ana = _cuenta("ana")
    _guardar(ana, b"uno", nombre="Declaración de bienes.pdf")
    _guardar(ana, b"dos", nombre="acta.pdf")
    _, auditor = _cuenta("auditor", "auditoria.descargas")

    def buscar(termino):
        respuesta = auditor.get(URL, {"q": termino})
        assert respuesta.status_code == 200
        return [fila["nombre"] for fila in respuesta.json()["results"]]

    assert buscar("declaracion") == ["Declaración de bienes.pdf"]
    assert buscar("BIENES ana") == ["Declaración de bienes.pdf"]
    assert buscar("declaracion acta") == []
    # La IP también se busca, por fragmentos.
    assert len(buscar("10.0.2")) == 2
