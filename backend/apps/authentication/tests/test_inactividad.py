"""La sesión se cierra sola tras un rato sin usarse.

El plazo es **deslizante**: no mide cuánto lleva abierta la sesión sino cuánto
lleva sin usarse, así que cada petición vuelve a ponerlo a cero. Sin esto, el
refresh token dura días y una sesión abierta en un equipo compartido sigue
sirviendo al día siguiente.
"""

import datetime

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import Session
from apps.authentication.services import AuthenticationService
from apps.users.models import User

pytestmark = pytest.mark.django_db

RUTA = "/api/v1/auth/me/"


@pytest.fixture
def sesion_abierta():
    usuario = User.objects.create_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return cliente, tokens, Session.objects.get(user=usuario)


def _sin_usar_desde_hace(sesion: Session, horas: float) -> None:
    """Mueve la marca de actividad hacia atrás.

    Se hace con `update` y no con `save` porque el campo es `auto_now`: un
    `save` volvería a ponerlo en la hora actual y la prueba no probaría nada.
    """
    Session.objects.filter(pk=sesion.pk).update(
        last_used_at=timezone.now() - datetime.timedelta(hours=horas)
    )


def test_a_las_cuatro_horas_sin_usarla_se_cierra(sesion_abierta):
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 4.1)

    respuesta = cliente.get(RUTA)

    assert respuesta.status_code == 401
    assert respuesta.data["error"]["code"] == "session_idle_timeout"
    assert "inactividad" in respuesta.data["error"]["message"]


def test_y_se_cierra_de_verdad_no_solo_se_rechaza(sesion_abierta):
    """Si quedara abierta, el refresh token seguiría valiendo y la siguiente
    petición la reviviría."""
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 4.1)

    cliente.get(RUTA)

    sesion.refresh_from_db()
    assert sesion.revoked_at is not None


def test_justo_antes_del_plazo_sigue_viva(sesion_abierta):
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 3.9)

    assert cliente.get(RUTA).status_code == 200


def test_usarla_reinicia_la_cuenta(sesion_abierta):
    """Lo que pidió el requisito: volver antes del plazo lo empieza de nuevo."""
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 3.9)

    assert cliente.get(RUTA).status_code == 200

    # Esa petición acaba de reiniciar la cuenta: tres horas más tarde —siete
    # desde la última vez que se usó antes— la sesión sigue en pie.
    _sin_usar_desde_hace(sesion, 3.0)
    assert cliente.get(RUTA).status_code == 200


def test_renovar_el_token_no_cuenta_como_actividad(sesion_abierta):
    """Lo hace el navegador solo, no la persona.

    Si contara, una pestaña olvidada abierta mantendría la sesión viva sin
    que nadie esté delante, que es justo lo que el plazo evita.
    """
    _cliente, tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 2.0)
    antes = Session.objects.get(pk=sesion.pk).last_used_at

    AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    assert Session.objects.get(pk=sesion.pk).last_used_at == antes


def test_pasado_el_plazo_tampoco_se_renueva(sesion_abierta):
    from rest_framework.exceptions import AuthenticationFailed

    _cliente, tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 4.1)

    with pytest.raises(AuthenticationFailed) as error:
        AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    assert error.value.detail.code == "session_idle_timeout"


@override_settings(SESSION_IDLE_TIMEOUT=datetime.timedelta(minutes=30))
def test_el_plazo_es_configurable(sesion_abierta):
    """Cuatro horas es el valor por defecto, no una constante del código: un
    despliegue con datos más sensibles lo baja desde el entorno."""
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 0.75)

    assert cliente.get(RUTA).status_code == 401


@override_settings(SESSION_ACTIVITY_WRITE_EVERY=datetime.timedelta(seconds=60))
def test_no_se_escribe_en_cada_peticion(sesion_abierta):
    """Con la marca recién puesta, un UPDATE más no cambia nada y multiplicaría
    las escrituras por el tráfico de toda la aplicación."""
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 10 / 3600)  # diez segundos
    antes = Session.objects.get(pk=sesion.pk).last_used_at

    cliente.get(RUTA)

    assert Session.objects.get(pk=sesion.pk).last_used_at == antes


@override_settings(SESSION_ACTIVITY_WRITE_EVERY=datetime.timedelta(seconds=60))
def test_pero_sí_pasado_el_margen(sesion_abierta):
    cliente, _tokens, sesion = sesion_abierta
    _sin_usar_desde_hace(sesion, 2 / 60)  # dos minutos
    antes = Session.objects.get(pk=sesion.pk).last_used_at

    cliente.get(RUTA)

    assert Session.objects.get(pk=sesion.pk).last_used_at > antes
