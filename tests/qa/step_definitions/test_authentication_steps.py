"""Step definitions de tests/qa/features/authentication.feature (subconjunto
crítico — ver tests/qa/acceptance-criteria-traceability.md para qué
escenarios están efectivamente automatizados vía pytest-bdd)."""

import pytest
from pytest_bdd import given, parsers, scenario, then, when
from rest_framework.test import APIClient

from apps.authentication.models import Session
from apps.users.models import User

pytestmark = pytest.mark.django_db

PASSWORD = "Sup3r-Secr3t!"


@pytest.fixture
def context():
    return {}


@pytest.fixture
def api_client():
    return APIClient()


@scenario("../features/authentication.feature", "Inicio de sesión exitoso")
def test_successful_login():
    pass


@scenario(
    "../features/authentication.feature",
    "Un usuario deshabilitado no puede iniciar sesión",
)
def test_disabled_user_cannot_login():
    pass


@given(parsers.parse('que existe un usuario activo "{username}" con contraseña válida'))
def existing_active_user(username, context):
    context["user"] = User.objects.create_user(
        username=username, email=f"{username}@example.com", password=PASSWORD
    )


@given(parsers.parse('que el usuario "{username}" está deshabilitado'))
def disable_user(username, context):
    user = context["user"]
    assert user.username == username
    user.status = User.Status.DISABLED
    user.save()


@when("el usuario envía sus credenciales correctas al sistema")
def login_with_correct_credentials(api_client, context):
    context["response"] = api_client.post(
        "/api/v1/auth/login/",
        {"identifier": context["user"].username, "password": PASSWORD},
        format="json",
    )


@when("el usuario intenta iniciar sesión con sus credenciales correctas")
def attempt_login_with_correct_credentials(api_client, context):
    context["response"] = api_client.post(
        "/api/v1/auth/login/",
        {"identifier": context["user"].username, "password": PASSWORD},
        format="json",
    )


@then("el backend valida la contraseña mediante el mecanismo de hash de Django")
def password_validated_via_hash(context):
    assert context["response"].status_code == 200


@then("genera un access token y un refresh token válidos")
def tokens_issued(context):
    assert "access" in context["response"].data
    assert "refresh" in context["response"].data


@then("se registra una nueva sesión activa")
def session_registered(context):
    assert Session.objects.filter(user=context["user"], revoked_at__isnull=True).exists()


@then("el sistema rechaza la autenticación con el mensaje genérico")
def rejects_with_generic_message(context):
    assert context["response"].status_code == 401
    assert "access" not in context["response"].data


@then("no se emiten tokens")
def no_tokens_issued(context):
    assert "access" not in context["response"].data
