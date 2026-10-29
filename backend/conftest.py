import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Evita que el throttling de DRF (basado en cache) contamine tests
    entre sí, ya que la cache por defecto vive en memoria del proceso."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _sin_lista_de_objetos_externos(settings):
    """Las pruebas no dependen del `.env` de cada equipo: sin lista de objetos
    permitidos de la base externa, solo se bloquean los del sistema. Las
    pruebas de la lista blanca la fijan ellas mismas (auditoría de seguridad,
    29/10/2026)."""
    settings.EXTERNAL_DB_OBJETOS_PERMITIDOS = []


@pytest.fixture(autouse=True)
def _multiempresa(settings):
    """Las pruebas siguen cubriendo la separación por empresa, que sigue por
    dentro aunque el sistema trabaje con una sola (ver apps.empresas.una_sola,
    que tiene sus propias pruebas con `MULTIEMPRESA = False`)."""
    settings.MULTIEMPRESA = True


@pytest.fixture(autouse=True)
def _empresa_de_pruebas(request):
    """Corre cada prueba dentro de una empresa, como corre producción.

    Todo lo que se registra pertenece a una empresa y las consultas se acotan a
    la activa. Una prueba que crea sus datos con el ORM —fuera de cualquier
    petición— los dejaría sin empresa, y luego los pediría por API desde una:
    no se verían. No es un fallo del código sino de la prueba, que estaría
    montando un escenario que en producción no existe.

    Las pruebas de aislamiento (`apps/empresas`) anulan este fixture: ahí el
    objeto de estudio es justamente qué empresa resuelve cada petición.
    """
    pedidos = set(request.fixturenames)
    if not {"db", "transactional_db"} & pedidos:
        yield
        return

    # Se pide explícitamente para que la base esté montada antes de consultarla:
    # los fixtures autouse corren antes que aquellos de los que no dependen.
    request.getfixturevalue("transactional_db" if "transactional_db" in pedidos else "db")

    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    empresa, _ = Empresa.objects.get_or_create(
        codigo="EMP", defaults={"nombre": "Empresa de pruebas"}
    )
    with usando_empresa(empresa):
        yield


@pytest.fixture(autouse=True)
def _motivo_de_cambio_por_defecto(monkeypatch):
    """Todo cambio al organigrama pide su motivo (`X-Motivo-Cambio`,
    apps.organizacion.versiones). Los clientes de prueba lo llevan por
    defecto, también después de `credentials(...)`; las pruebas de la
    bitácora lo quitan (`HTTP_X_MOTIVO_CAMBIO=""`) o lo cambian a propósito."""
    from rest_framework.test import APIClient

    defecto = {"HTTP_X_MOTIVO_CAMBIO": "Prueba automatica"}
    original_init, original_credentials = APIClient.__init__, APIClient.credentials

    def con_motivo(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self._credentials = {**defecto, **self._credentials}

    def credenciales(self, **kwargs):
        original_credentials(self, **{**defecto, **kwargs})

    monkeypatch.setattr(APIClient, "__init__", con_motivo)
    monkeypatch.setattr(APIClient, "credentials", credenciales)
