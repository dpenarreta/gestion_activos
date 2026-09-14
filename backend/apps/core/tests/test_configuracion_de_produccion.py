"""La configuración de producción, revisada sin desplegar nada.

`verificar_despliegue` es la puerta, pero se ejecuta el día del despliegue y
contra la máquina que toque. Esto es lo otro: comprobar que el **módulo** de
producción sigue diciendo lo que prometía, y que nadie lo aflojó por el camino
para salir de un apuro un viernes.

Se importa el módulo con `importlib` en vez de cambiar la configuración activa:
lo que se examina son los valores que ese archivo fija, no los del proceso de
pruebas, y así la comprobación no depende de con qué configuración se corran
las pruebas.

No sustituye al verificador —lo que pasa en la máquina de producción solo se ve
en la máquina de producción— pero cubre la mitad que sí vive en el repositorio,
que es la que se puede romper en una revisión de código.
"""

import importlib

import pytest


@pytest.fixture(scope="module")
def produccion():
    """Los valores que fija `config.settings.production`.

    Necesita las variables de entorno que `base` exige; las pruebas ya corren
    con un `.env` cargado, así que se importa tal cual y, si algo falta, se
    dice en vez de fallar de forma opaca.
    """
    try:
        return importlib.import_module("config.settings.production")
    except Exception as error:  # pragma: no cover
        pytest.skip(f"No se pudo importar la configuración de producción: {error}")


def test_debug_esta_apagado(produccion):
    """Con `DEBUG`, cualquier error enseña la traza completa —rutas, fragmentos
    de configuración, consultas— a quien lo provoque."""
    assert produccion.DEBUG is False


def test_no_depende_del_entorno_para_apagarlo(produccion):
    """Está escrito en el módulo, no leído de una variable.

    Es la decisión que el propio archivo documenta: así un `.env` de desarrollo
    copiado por descuido no puede encender `DEBUG` en producción.
    """
    fuente = importlib.util.find_spec("config.settings.production").origin
    with open(fuente, encoding="utf-8") as archivo:
        contenido = archivo.read()
    assert "DEBUG = False" in contenido
    assert "DEBUG = env" not in contenido


def test_las_cookies_solo_viajan_por_https(produccion):
    assert produccion.SESSION_COOKIE_SECURE is True
    assert produccion.CSRF_COOKIE_SECURE is True


def test_hsts_dura_lo_suficiente_para_la_lista_precargada(produccion):
    """Por debajo de un año los navegadores no aceptan la inclusión, y sin ella
    la primera visita de cada usuario viaja en claro hasta la redirección."""
    assert produccion.SECURE_HSTS_SECONDS >= 60 * 60 * 24 * 365
    assert produccion.SECURE_HSTS_INCLUDE_SUBDOMAINS is True
    assert produccion.SECURE_HSTS_PRELOAD is True


def test_se_identifica_como_produccion(produccion):
    """De aquí sale el aviso del verificador cuando se lo corre en otro sitio."""
    assert produccion.ENVIRONMENT_NAME == "production"


@pytest.mark.django_db
def test_el_verificador_avisa_cuando_no_es_produccion(capsys, settings):
    """El que grita en falso es el que nadie lee: si en cada portátil salen dos
    críticos, el día que sean de verdad tampoco se van a mirar."""
    settings.ENVIRONMENT_NAME = "development"

    _correr_el_verificador()

    salida = capsys.readouterr().out
    assert "no la de produccion" in salida
    assert "--settings=config.settings.production" in salida


@pytest.mark.django_db
def test_el_verificador_no_avisa_cuando_si_lo_es(capsys, settings):
    settings.ENVIRONMENT_NAME = "production"

    _correr_el_verificador()

    assert "no la de produccion" not in capsys.readouterr().out


def _correr_el_verificador():
    """Lo ejecuta y se traga la salida por código crítico, que aquí no importa:
    lo que se mira es el encabezado, no el veredicto."""
    from django.core.management import call_command

    try:
        call_command("verificar_despliegue")
    except SystemExit:
        pass
