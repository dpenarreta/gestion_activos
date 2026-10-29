"""El bloqueo del inicio de sesión cuenta por identificador **y IP**.

Auditoría de seguridad, 29/10/2026: contaba solo por identificador, y cinco
intentos con el usuario de otra persona la dejaban fuera quince minutos, una y
otra vez. Ahora el bloqueo afecta a ese identificador desde esa IP, y un límite
más alto, que suma todas las IP, frena el ataque repartido.
"""

import pytest
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient

from apps.authentication.models import LoginAttempt
from apps.authentication.services import (
    GENERIC_AUTH_ERROR,
    LOCKOUT_ERROR,
    AuthenticationService,
    BruteForceProtectionService,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db

CLAVE = "Sup3r-Secr3t!"


@pytest.fixture
def ada():
    return User.objects.create_user(username="ada", email="ada@example.com", password=CLAVE)


def _entrar(password, ip, identifier="ada"):
    return AuthenticationService.authenticate_and_issue_tokens(
        identifier=identifier, password=password, ip_address=ip
    )


def _fallar(veces, ip, identifier="ada"):
    for _ in range(veces):
        with pytest.raises(AuthenticationFailed):
            _entrar("otra-clave", ip, identifier)


def test_los_fallos_desde_una_ip_no_bloquean_al_dueno_desde_la_suya(ada):
    _fallar(settings.LOGIN_MAX_FAILED_ATTEMPTS, "203.0.113.9")

    assert "access" in _entrar(CLAVE, "10.0.0.5")


def test_la_ip_que_insiste_si_queda_bloqueada_aun_con_la_clave_buena(ada):
    _fallar(settings.LOGIN_MAX_FAILED_ATTEMPTS, "203.0.113.9")

    with pytest.raises(AuthenticationFailed) as error:
        _entrar(CLAVE, "203.0.113.9")
    assert str(error.value.detail) == LOCKOUT_ERROR


def test_seguir_insistiendo_bloqueado_no_suma_al_limite_global(ada):
    """Si sumara, una sola IP llegaría al global y dejaría fuera al dueño."""
    ip = "203.0.113.9"
    _fallar(settings.LOGIN_MAX_FAILED_ATTEMPTS + settings.LOGIN_MAX_FAILED_ATTEMPTS_GLOBAL, ip)

    assert LoginAttempt.objects.filter(identifier="ada").count() == (
        settings.LOGIN_MAX_FAILED_ATTEMPTS
    )
    assert "access" in _entrar(CLAVE, "10.0.0.5")


def test_el_ataque_repartido_entre_muchas_ip_si_bloquea(ada):
    por_ip = settings.LOGIN_MAX_FAILED_ATTEMPTS - 1
    ips = -(-settings.LOGIN_MAX_FAILED_ATTEMPTS_GLOBAL // por_ip)
    for n in range(ips):
        _fallar(por_ip, f"198.51.100.{n + 1}")

    assert BruteForceProtectionService.is_locked_out("ada", "10.0.0.5")
    with pytest.raises(AuthenticationFailed) as error:
        _entrar(CLAVE, "10.0.0.5")
    assert str(error.value.detail) == LOCKOUT_ERROR


def test_el_identificador_inexistente_se_bloquea_igual(ada):
    _fallar(settings.LOGIN_MAX_FAILED_ATTEMPTS, "203.0.113.9", identifier="nadie")

    with pytest.raises(AuthenticationFailed) as error:
        _entrar("lo-que-sea", "203.0.113.9", identifier="nadie")
    assert str(error.value.detail) == LOCKOUT_ERROR


def test_sin_ip_conocida_cuenta_solo_por_identificador(ada):
    """Lo prudente cuando no se sabe de dónde viene: el límite bajo."""
    _fallar(settings.LOGIN_MAX_FAILED_ATTEMPTS, "203.0.113.9")

    assert BruteForceProtectionService.is_locked_out("ada")


def test_por_la_api_el_mensaje_sigue_siendo_generico(ada):
    cliente = APIClient(REMOTE_ADDR="203.0.113.9")
    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        respuesta = cliente.post(
            "/api/v1/auth/login/", {"identifier": "ada", "password": "mala"}, format="json"
        )
        assert respuesta.data["error"]["message"] == GENERIC_AUTH_ERROR

    bloqueada = cliente.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": CLAVE}, format="json"
    )
    assert bloqueada.status_code == 401
    assert bloqueada.data["error"]["message"] == LOCKOUT_ERROR

    desde_otra = APIClient(REMOTE_ADDR="10.0.0.5").post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": CLAVE}, format="json"
    )
    assert desde_otra.status_code == 200
