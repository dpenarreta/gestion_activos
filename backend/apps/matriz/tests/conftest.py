import pytest


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global, como en `apps/empresas`: aquí se estudia qué
    puede hacer cada cuenta en cada empresa, y fijar una de antemano taparía
    justo lo que se prueba."""
    yield
