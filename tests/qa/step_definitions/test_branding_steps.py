"""Step definitions de tests/qa/features/branding.feature (subconjunto crítico)."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from pytest_bdd import given, scenario, then, when
from rest_framework.test import APIClient

from apps.branding.catalog import DEFAULT_THEME
from apps.core.models import AuditLog
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def context():
    return {}


def _grant(user, *codenames):
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        *Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )


@scenario("../features/branding.feature", "Cambiar el nombre del sitio")
def test_change_site_name():
    pass


@scenario("../features/branding.feature", "Ingresar un color hexadecimal inválido")
def test_invalid_hex_color():
    pass


@given('que existe un administrador con los permisos "configuracion.ver" y "configuracion.editar"')
def admin_with_config_permissions(context):
    admin = User.objects.create_user(
        username="branding_admin_qa", email="branding_admin_qa@example.com", password="Sup3r-Secr3t!"
    )
    _grant(admin, "configuracion.ver", "configuracion.editar")
    context["client"] = APIClient()
    context["client"].force_authenticate(user=admin)


@when("el administrador actualiza el nombre del sitio")
def update_site_name(context):
    context["response"] = context["client"].patch(
        "/api/v1/admin/theme/", {"site_name": "QA Portal"}, format="json"
    )


@when("el administrador ingresa un valor que no es un color hexadecimal válido")
def invalid_hex(context):
    context["response"] = context["client"].patch(
        "/api/v1/admin/theme/", {"color_primary": "not-a-color"}, format="json"
    )


@then("el cambio se guarda y queda disponible de inmediato en el tema público")
def change_saved(context):
    assert context["response"].status_code == 200
    public = APIClient().get("/api/v1/theme/current/")
    assert public.data["site_name"] == "QA Portal"


@then('se registra un evento de auditoría "theme.updated"')
def theme_updated_audited():
    assert AuditLog.objects.filter(action="theme.updated").exists()


@then("el sistema rechaza el guardado")
def rejects_save(context):
    assert context["response"].status_code == 400


@then("el tema conserva su valor anterior")
def theme_unchanged(context):
    current = APIClient().get("/api/v1/theme/current/")
    assert current.data["color_primary"] == DEFAULT_THEME["color_primary"]
