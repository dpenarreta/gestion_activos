import pytest


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global: aquí se estudia qué empresa resuelve cada
    petición, así que fijarla de antemano taparía justo lo que se prueba."""
    yield
