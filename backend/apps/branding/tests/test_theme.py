"""Cobertura de tests/qa/features/branding.feature (adición deliberada más
allá del mínimo estricto del prompt de partición — ver docs/architecture.md)."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.branding.catalog import DEFAULT_THEME
from apps.core.models import AuditLog
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant(user: User, *codenames: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@pytest.fixture
def config_admin_client():
    user = User.objects.create_user(
        username="theme_admin", email="theme_admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "configuracion.ver", "configuracion.editar")
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


# --- Cambio del nombre del sitio ----------------------------------------------


def test_changing_site_name_is_saved_and_audited(config_admin_client):
    client, actor = config_admin_client

    response = client.patch("/api/v1/admin/theme/", {"site_name": "Mi Portal"}, format="json")

    assert response.status_code == 200
    assert response.data["site_name"] == "Mi Portal"
    assert client.get("/api/v1/theme/current/").data["site_name"] == "Mi Portal"
    assert AuditLog.objects.filter(
        action="theme.updated", new_values__site_name="Mi Portal"
    ).exists()


# --- Selección de color / ingreso manual válido -------------------------------


def test_valid_hex_color_is_applied_and_saved(config_admin_client):
    client, actor = config_admin_client

    response = client.patch("/api/v1/admin/theme/", {"color_primary": "#123abc"}, format="json")

    assert response.status_code == 200
    assert response.data["color_primary"] == "#123abc"


# --- Ingreso de color hexadecimal inválido ------------------------------------


def test_invalid_hex_color_is_rejected_and_theme_stays_unchanged(config_admin_client):
    client, actor = config_admin_client

    response = client.patch("/api/v1/admin/theme/", {"color_primary": "not-a-color"}, format="json")

    assert response.status_code == 400
    current = client.get("/api/v1/theme/current/").data
    assert current["color_primary"] == DEFAULT_THEME["color_primary"]


# --- Contraste insuficiente ----------------------------------------------------


def test_insufficient_contrast_returns_warning_but_still_saves(config_admin_client):
    client, actor = config_admin_client

    response = client.patch(
        "/api/v1/admin/theme/",
        {"color_text": "#ffffff", "color_background": "#ffffff"},
        format="json",
    )

    assert response.status_code == 200
    assert len(response.data["warnings"]) > 0
    assert any("texto principal" in w["elements_affected"] for w in response.data["warnings"])
    # A diferencia del hex inválido, el contraste insuficiente NO bloquea el guardado.
    assert client.get("/api/v1/theme/current/").data["color_text"] == "#ffffff"


# --- Catálogo de tipografía/radio disponible para el selector ------------------


def test_theme_options_endpoint_lists_font_and_radius_catalog(config_admin_client):
    client, actor = config_admin_client

    response = client.get("/api/v1/admin/theme/options/")

    assert response.status_code == 200
    font_keys = [font["key"] for font in response.data["fonts"]]
    assert "system-ui" in font_keys
    assert len(font_keys) >= 5
    assert "md" in response.data["border_radii"]


# --- Restauración del tema predeterminado --------------------------------------


def test_reset_restores_defaults_and_audits(config_admin_client):
    client, actor = config_admin_client
    client.patch(
        "/api/v1/admin/theme/",
        {"site_name": "Personalizado", "color_primary": "#000000"},
        format="json",
    )

    response = client.post("/api/v1/admin/theme/reset/")

    assert response.status_code == 200
    assert response.data["site_name"] == DEFAULT_THEME["site_name"]
    assert response.data["color_primary"] == DEFAULT_THEME["color_primary"]
    assert AuditLog.objects.filter(action="theme.reset").exists()


# --- El tema se puede leer sin autenticación (para pintar login/registro) ----


def test_current_theme_endpoint_is_public():
    response = APIClient().get("/api/v1/theme/current/")
    assert response.status_code == 200
    assert response.data["site_name"] == DEFAULT_THEME["site_name"]


# --- Acceso sin permiso -------------------------------------------------------


def test_editing_theme_without_permission_is_rejected():
    user = User.objects.create_user(
        username="plain", email="plain@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.patch("/api/v1/admin/theme/", {"site_name": "Hackeado"}, format="json")

    assert response.status_code == 403
