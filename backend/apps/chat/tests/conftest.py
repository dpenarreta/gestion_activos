import pytest


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global: la empresa la decide la cabecera de cada
    petición, que es justo el aislamiento que se prueba."""
    yield


@pytest.fixture(autouse=True)
def _al_confirmar_en_el_acto(monkeypatch):
    """Los avisos van en `transaction.on_commit`: en las pruebas, en el acto."""
    monkeypatch.setattr(
        "apps.chat.services.transaction.on_commit", lambda funcion, *a, **k: funcion()
    )
