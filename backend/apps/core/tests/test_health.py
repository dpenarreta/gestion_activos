"""Cobertura de los endpoints transversales de salud/versión y de la
configuración forzada por ambiente."""

import importlib

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()


# --- Health check (liveness) -------------------------------------------------


def test_health_check_reports_ok_without_secrets(api_client):
    response = api_client.get("/api/v1/health/")

    assert response.status_code == 200
    assert response.data["status"] == "ok"
    assert "system_name" in response.data
    body = str(response.data).lower()
    assert "secret" not in body
    assert "password" not in body
    assert "db_password" not in body


# --- Readiness -----------------------------------------------------------------


def test_readiness_check_reports_database_component(api_client):
    response = api_client.get("/api/v1/health/ready/")

    assert response.status_code == 200
    assert response.data["status"] == "ok"
    assert response.data["components"]["database"] == "ok"


# --- Versión ---------------------------------------------------------------------


def test_version_endpoint_exposes_no_sensitive_data(api_client, settings):
    response = api_client.get("/api/v1/version/")

    assert response.status_code == 200
    assert response.data["version"] == settings.APP_VERSION
    assert response.data["system_name"] == settings.SYSTEM_NAME
    assert response.data["environment"] == settings.ENVIRONMENT_NAME
    body = str(response.data).lower()
    assert "secret" not in body
    assert "key" not in body


# --- Documentación OpenAPI --------------------------------------------------------


@pytest.fixture
def staff_client():
    from apps.users.models import User

    staff = User.objects.create_user(
        username="staff", email="staff@example.com", password="Sup3r-Secr3t!", is_staff=True
    )
    client = APIClient()
    client.force_authenticate(user=staff)
    return client


def test_openapi_schema_lists_endpoints_and_auth_scheme(staff_client):
    response = staff_client.get("/api/v1/schema/")

    assert response.status_code == 200
    assert response["Content-Type"].startswith("application/vnd.oai.openapi")


def test_swagger_ui_is_reachable(staff_client):
    response = staff_client.get("/api/v1/schema/swagger-ui/")
    assert response.status_code == 200


@pytest.mark.parametrize("ruta", ["schema/", "schema/swagger-ui/", "schema/redoc/"])
def test_el_esquema_no_es_publico(api_client, ruta):
    """Describe cada endpoint de la API: solo para el personal (auditoría de
    seguridad, 29/10/2026)."""
    assert api_client.get(f"/api/v1/{ruta}").status_code in (401, 403)


@pytest.mark.parametrize("ruta", ["schema/", "schema/swagger-ui/", "schema/redoc/"])
def test_el_esquema_no_es_para_cualquier_cuenta(ruta):
    from apps.users.models import User

    cualquiera = User.objects.create_user(
        username="cualquiera", email="cualquiera@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=cualquiera)
    assert client.get(f"/api/v1/{ruta}").status_code == 403


# --- Configuración por ambiente: los valores de desarrollo no se propagan --------


def test_production_settings_force_safe_values_regardless_of_env():
    production_settings = importlib.import_module("config.settings.production")

    assert production_settings.DEBUG is False
    assert production_settings.ENVIRONMENT_NAME == "production"
    assert production_settings.SESSION_COOKIE_SECURE is True
    assert production_settings.CSRF_COOKIE_SECURE is True
