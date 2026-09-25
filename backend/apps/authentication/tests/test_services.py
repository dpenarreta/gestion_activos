import pytest
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed

from apps.authentication.services import AuthenticationService

pytestmark = pytest.mark.django_db


def test_register_user_creates_user_with_hashed_password():
    user = AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert user.pk is not None
    assert user.check_password("Sup3r-Secr3t!")


def test_authenticate_and_issue_tokens_returns_access_and_refresh():
    AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    assert "access" in tokens
    assert "refresh" in tokens


def test_authenticate_with_wrong_password_raises():
    AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    with pytest.raises(AuthenticationFailed):
        AuthenticationService.authenticate_and_issue_tokens(
            identifier="ada", password="wrong-password"
        )


def test_authenticate_by_email_works():
    AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert "access" in tokens


def test_el_inicio_de_sesion_anota_la_ultima_conexion():
    """Sin esto, la columna «última conexión» del listado de cuentas diría
    «Nunca» para todo el mundo: el login emite tokens en vez de abrir una
    sesión de Django, que es lo que normalmente escribe ese campo."""
    user = AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    assert user.last_login is None

    antes = timezone.now()
    AuthenticationService.authenticate_and_issue_tokens(identifier="ada", password="Sup3r-Secr3t!")

    user.refresh_from_db()
    assert user.last_login is not None
    assert user.last_login >= antes


def test_el_intento_fallido_no_cuenta_como_conexion():
    user = AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    with pytest.raises(AuthenticationFailed):
        AuthenticationService.authenticate_and_issue_tokens(
            identifier="ada", password="wrong-password"
        )

    user.refresh_from_db()
    assert user.last_login is None


def test_renovar_el_token_no_mueve_la_ultima_conexion():
    """Refrescar reutiliza la sesión que ya existe. Si contara, una pestaña
    olvidada abierta parecería alguien trabajando toda la noche."""
    user = AuthenticationService.register_user(
        username="ada", email="ada@example.com", password="Sup3r-Secr3t!"
    )
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="ada", password="Sup3r-Secr3t!"
    )
    user.refresh_from_db()
    primera = user.last_login

    AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    user.refresh_from_db()
    assert user.last_login == primera
