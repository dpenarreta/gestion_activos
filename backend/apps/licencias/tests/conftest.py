"""Los documentos que suben las pruebas van a una carpeta temporal, no a la
carpeta `media` del proyecto (los permisos médicos exigen documento desde el
05/11/2026)."""

import pytest


@pytest.fixture(autouse=True)
def _archivos_temporales(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
