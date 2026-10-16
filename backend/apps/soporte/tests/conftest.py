import pytest

from apps.soporte.tests.test_soporte import mesa  # noqa: F401 (fixture compartido)


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global, como en `apps/empresas` y la Matriz: aquí la
    empresa la decide el formulario público (por su código) o la membresía de
    quien entra, y fijar una de antemano taparía justo lo que se prueba."""
    yield


@pytest.fixture(autouse=True)
def _al_confirmar_en_el_acto(monkeypatch):
    """Los avisos y el reparto van en `transaction.on_commit`, que dentro de la
    transacción de cada prueba nunca llega: se ejecutan en el acto."""
    monkeypatch.setattr(
        "apps.soporte.services.transaction.on_commit", lambda funcion, *a, **k: funcion()
    )
    monkeypatch.setattr(
        "apps.soporte.views.transaction.on_commit", lambda funcion, *a, **k: funcion()
    )
