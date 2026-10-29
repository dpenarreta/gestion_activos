"""La IP del cliente no se toma de lo que el cliente escriba.

Auditoría de seguridad, 29/10/2026: se tomaba el primer valor de
X-Forwarded-For, que lo pone quien hace la petición. Detrás de un proxy (IIS
con ARR en producción, `NUM_PROXIES=1`) la buena es la que agregó el proxy: la
última.
"""

import pytest
from django.test import RequestFactory
from rest_framework.settings import api_settings

from apps.core.request_meta import get_client_ip


@pytest.fixture
def proxies(settings):
    def fijar(numero):
        settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "NUM_PROXIES": numero}
        api_settings.reload()

    yield fijar
    api_settings.reload()


def _peticion(xff=None, remote="10.0.2.33"):
    extra = {"REMOTE_ADDR": remote}
    if xff is not None:
        extra["HTTP_X_FORWARDED_FOR"] = xff
    return RequestFactory().get("/", **extra)


def test_por_defecto_hay_un_proxy():
    assert api_settings.NUM_PROXIES == 1


def test_el_valor_falsificado_al_principio_no_cuenta(proxies):
    proxies(1)
    # El cliente manda «1.2.3.4»; IIS agrega la IP real de quien se conectó.
    assert get_client_ip(_peticion("1.2.3.4, 198.51.100.7")) == "198.51.100.7"


def test_sin_falsificar_es_la_que_agrego_el_proxy(proxies):
    proxies(1)
    assert get_client_ip(_peticion("198.51.100.7")) == "198.51.100.7"


def test_sin_cabecera_vale_remote_addr(proxies):
    proxies(1)
    assert get_client_ip(_peticion()) == "10.0.2.33"
    assert get_client_ip(_peticion("")) == "10.0.2.33"


def test_con_dos_proxies_es_la_penultima(proxies):
    proxies(2)
    assert get_client_ip(_peticion("1.2.3.4, 198.51.100.7, 10.0.0.1")) == "198.51.100.7"


def test_sin_proxies_la_cabecera_se_ignora(proxies):
    proxies(0)
    assert get_client_ip(_peticion("1.2.3.4")) == "10.0.2.33"
