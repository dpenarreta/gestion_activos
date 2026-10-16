"""Las pruebas de Cartera vienen del sistema de origen y son clases
`django.test.TestCase`: el fixture global de la empresa no las alcanza (mira si
la prueba pidió `db`, y estas no lo piden). Aquí se hace lo mismo para ellas, y
además los archivos que suben van a un directorio temporal, no a `media/`."""

from contextlib import nullcontext

from pathlib import Path

import pytest
from django.conf import settings
from django.test import TransactionTestCase, override_settings


@pytest.fixture(autouse=True)
def _empresa_de_pruebas(request, django_db_blocker, tmp_path):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    empresa = None
    clase = getattr(request, "cls", None)
    if clase is not None and issubclass(clase, TransactionTestCase):
        with django_db_blocker.unblock():
            empresa, _ = Empresa.objects.get_or_create(
                codigo="EMP", defaults={"nombre": "Empresa de pruebas"}
            )
    # Solo si la prueba no fijó ya los suyos (algunas clases lo hacen).
    directorios = {}
    medios = Path(settings.MEDIA_ROOT)
    if Path(settings.CARTERA_TEMP_UPLOADS_DIR).is_relative_to(medios):
        directorios["CARTERA_TEMP_UPLOADS_DIR"] = tmp_path / "temp"
    if Path(settings.CARTERA_ARCHIVOS_DIR).is_relative_to(medios):
        directorios["CARTERA_ARCHIVOS_DIR"] = tmp_path / "archivos"
    with (
        override_settings(MEDIA_ROOT=tmp_path, **directorios),
        usando_empresa(empresa) if empresa else nullcontext(),
    ):
        yield
