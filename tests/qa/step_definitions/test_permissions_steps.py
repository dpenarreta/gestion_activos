"""Step definitions de tests/qa/features/permissions.feature (subconjunto crítico)."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from pytest_bdd import given, scenario, then, when
from rest_framework.test import APIClient

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


@scenario("../features/permissions.feature", "Consultar el catálogo completo de permisos")
def test_query_full_catalog():
    pass


@scenario("../features/permissions.feature", "Un usuario sin permiso no puede consultar el catálogo")
def test_catalog_requires_permission():
    pass


@given('que existe un usuario con el permiso "permisos.ver"')
def user_with_permisos_ver(context):
    user = User.objects.create_user(
        username="perm_viewer_qa", email="perm_viewer_qa@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, "permisos.ver")
    context["client"] = APIClient()
    context["client"].force_authenticate(user=user)


@given('que existe un usuario sin el permiso "permisos.ver"')
def user_without_permisos_ver(context):
    user = User.objects.create_user(
        username="perm_plain_qa", email="perm_plain_qa@example.com", password="Sup3r-Secr3t!"
    )
    context["client"] = APIClient()
    context["client"].force_authenticate(user=user)


@when("solicita el catálogo de permisos")
def request_catalog(context):
    context["response"] = context["client"].get("/api/v1/admin/permissions/")


@when("intenta consultar el catálogo de permisos")
def try_request_catalog(context):
    context["response"] = context["client"].get("/api/v1/admin/permissions/")


@then("recibe todos los módulos (usuarios, roles, permisos, configuración, auditoría)")
def receives_all_modules(context):
    assert context["response"].status_code == 200
    for module in ("usuarios", "roles", "permisos", "configuracion", "auditoria"):
        assert module in context["response"].data


@then('cada permiso incluye su identificador estable ("modulo.accion") y su descripción')
def permissions_have_stable_ids(context):
    assert "usuarios.ver" in context["response"].data["usuarios"]["permissions"]


@then("el backend rechaza la solicitud con 403")
def rejected_403(context):
    assert context["response"].status_code == 403
