import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant(user: User, *codenames: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@pytest.fixture
def api_client():
    return APIClient()


def _cuenta(username="ada"):
    """Las cuentas se crean por dentro: el registro público ya no existe."""
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )


def test_el_registro_publico_ya_no_existe(api_client):
    """H-03: nadie se da de alta a sí mismo en el inventario interno del grupo.

    Se comprueba la ruta y no el código, porque lo que importa es que no haya
    forma de llegar: una vista sin `urls` sigue siendo código muerto, pero una
    ruta olvidada es una puerta.
    """
    respuesta = api_client.post(
        "/api/v1/auth/register/",
        {"username": "intrusa", "email": "intrusa@example.com", "password": "Sup3r-Secr3t!"},
        format="json",
    )

    assert respuesta.status_code == 404
    assert not User.objects.filter(username="intrusa").exists()


def test_login_endpoint_returns_tokens(api_client):
    _cuenta()
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )
    assert response.status_code == 200
    assert "access" in response.data


def test_login_endpoint_with_invalid_credentials_returns_error_contract(api_client):
    response = api_client.post(
        "/api/v1/auth/login/", {"identifier": "nobody", "password": "wrong"}, format="json"
    )
    assert response.status_code == 401
    assert "error" in response.data
    assert response.data["error"]["code"]


def test_me_endpoint_requires_authentication(api_client):
    response = api_client.get("/api/v1/auth/me/")
    assert response.status_code == 401


def test_me_endpoint_returns_current_user(api_client):
    _cuenta()
    login = api_client.post(
        "/api/v1/auth/login/", {"identifier": "ada", "password": "Sup3r-Secr3t!"}, format="json"
    )
    access_token = login.data["access"]
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
    response = api_client.get("/api/v1/auth/me/")
    assert response.status_code == 200
    assert response.data["username"] == "ada"


def test_me_endpoint_only_lists_permissions_the_user_actually_has(api_client):
    user = User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "auditoria.ver")
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["permissions"] == ["auditoria.ver"]
    assert "usuarios.ver" not in response.data["permissions"]
    assert "roles.ver" not in response.data["permissions"]


def test_me_endpoint_lists_permissions_granted_via_catalog(api_client):
    user = User.objects.create_user(
        username="admin", email="admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "usuarios.ver")
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert "usuarios.ver" in response.data["permissions"]
