"""Permite ejecutar los step definitions de pytest-bdd (que viven en
tests/qa/, fuera de backend/) contra el mismo proyecto Django del backend,
sin duplicar configuración. Ver docs/qa-strategy.md para el comando exacto
de ejecución."""

import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

import django  # noqa: E402

django.setup()

import pytest  # noqa: E402
from django.core.cache import cache  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_cache():
    """Mismo motivo que backend/conftest.py: evita que el throttling de
    DRF contamine escenarios entre sí."""
    cache.clear()
    yield
    cache.clear()
