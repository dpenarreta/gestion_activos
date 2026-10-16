import pytest


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global, como en la Mesa de ayuda: aquí la empresa la
    decide la cabecera de cada petición, y fijar una de antemano taparía justo
    el aislamiento que se prueba."""
    yield
