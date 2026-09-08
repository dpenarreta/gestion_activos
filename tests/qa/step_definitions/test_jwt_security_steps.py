"""Step definitions de tests/qa/features/jwt-security.feature (subconjunto crítico)."""

from datetime import timedelta

import pytest
from pytest_bdd import given, scenario, then, when
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.authentication.models import Session
from apps.authentication.services import AuthenticationService
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def context():
    return {}


@scenario("../features/jwt-security.feature", "Un access token expirado es rechazado")
def test_expired_token_rejected():
    pass


@given("que el usuario tiene un access token ya expirado")
def user_with_expired_token(context):
    user = User.objects.create_user(
        username="expired_qa", email="expired_qa@example.com", password="Sup3r-Secr3t!"
    )
    AuthenticationService.authenticate_and_issue_tokens(identifier="expired_qa", password="Sup3r-Secr3t!")
    session = Session.objects.get(user=user)
    expired_access = AccessToken.for_user(user)
    expired_access["sid"] = str(session.id)
    expired_access.set_exp(lifetime=timedelta(seconds=-10))
    context["expired_access"] = str(expired_access)


@when("intenta acceder a una ruta protegida")
def access_protected_route(context):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {context['expired_access']}")
    context["response"] = client.get("/api/v1/auth/me/")


@then("el sistema responde 401")
def responds_401(context):
    assert context["response"].status_code == 401


@then("la respuesta nunca incluye la contraseña ni información sensible")
def response_has_no_sensitive_data(context):
    assert "password" not in str(context["response"].data).lower()
