"""Step definitions de tests/qa/features/authorization.feature (subconjunto
crítico)."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from pytest_bdd import given, parsers, scenario, then, when
from rest_framework.test import APIClient

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


@scenario(
    "../features/authorization.feature",
    "Un usuario sin el permiso requerido recibe 403 y queda auditado",
)
def test_denied_without_permission():
    pass


@scenario(
    "../features/authorization.feature",
    "Un usuario con el permiso adecuado accede correctamente",
)
def test_allowed_with_permission():
    pass


@given(parsers.parse('que existe un usuario autenticado sin el permiso "{codename}"'))
def user_without_permission(codename, context):
    user = User.objects.create_user(
        username="plain_auth", email="plain_auth@example.com", password="Sup3r-Secr3t!"
    )
    context["user"] = user
    context["client"] = APIClient()
    context["client"].force_authenticate(user=user)


@given(parsers.parse('que existe un usuario con el permiso "{codename}"'))
def user_with_permission(codename, context):
    user = User.objects.create_user(
        username="granted_auth", email="granted_auth@example.com", password="Sup3r-Secr3t!"
    )
    _grant(user, codename)
    context["user"] = user
    context["client"] = APIClient()
    context["client"].force_authenticate(user=user)


@when("intenta acceder al listado de usuarios")
def try_list_users(context):
    context["response"] = context["client"].get("/api/v1/admin/users/")


@when("solicita el listado de usuarios")
def request_list_users(context):
    context["response"] = context["client"].get("/api/v1/admin/users/")


@then("el backend rechaza la solicitud con 403")
def rejected_403(context):
    assert context["response"].status_code == 403


@then('registra un evento de auditoría "access_denied" con el permiso requerido')
def access_denied_audited(context):
    denial = AuditLog.objects.filter(action="access_denied", target_id=str(context["user"].id)).first()
    assert denial is not None
    assert denial.new_values["required_permission"] == "usuarios.ver"


@then("el backend responde 200 con los datos")
def response_ok(context):
    assert context["response"].status_code == 200
