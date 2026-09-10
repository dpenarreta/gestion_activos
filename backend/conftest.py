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
