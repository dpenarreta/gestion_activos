"""El directorio del chat —y los selectores de personas que lo reutilizan— se
busca sin tildes ni mayúsculas (ver `apps.core.busqueda`)."""

from .test_chat import URL, _cliente, _persona, empresa  # noqa: F401 (fixture)


def _directorio(cliente, termino):
    respuesta = cliente.get(f"{URL}directorio/", {"q": termino})
    assert respuesta.status_code == 200
    return [p["correo"].split("@")[0] for p in respuesta.json()]


def test_ramirez_y_nandu_sin_tildes(empresa):  # noqa: F811
    yo = _persona("yo", empresa)
    jose = _persona("jramirez", empresa)
    jose.first_name, jose.last_name = "José Ñandú", "Ramírez"
    jose.save()
    _persona("acevallos", empresa)
    cliente = _cliente(yo, empresa)

    assert _directorio(cliente, "ramirez") == ["jramirez"]
    assert _directorio(cliente, "NANDU") == ["jramirez"]
    assert _directorio(cliente, "ramirez jose") == ["jramirez"]
    assert _directorio(cliente, "ramirez cevallos") == []
