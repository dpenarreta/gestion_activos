"""Step definitions de tests/qa/features/password-security.feature (subconjunto crítico)."""

import pytest
from pytest_bdd import given, scenario, then, when

from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def context():
    return {}


@scenario(
    "../features/password-security.feature",
    "La contraseña se almacena únicamente como hash Argon2",
)
def test_password_stored_as_argon2_hash():
    pass


@when("se crea un usuario con una contraseña")
def create_user_with_password(context):
    context["user"] = User.objects.create_user(
        username="hash_qa", email="hash_qa@example.com", password="Sup3r-Secr3t!"
    )


@then("el valor almacenado nunca coincide con la contraseña en texto plano")
def value_not_plaintext(context):
    assert context["user"].password != "Sup3r-Secr3t!"


@then("el hash usa el algoritmo Argon2 configurado como principal")
def uses_argon2(context):
    assert context["user"].password.startswith("argon2$")
