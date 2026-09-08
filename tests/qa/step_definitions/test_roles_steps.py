"""Step definitions de tests/qa/features/roles.feature (subconjunto crítico)."""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from pytest_bdd import given, scenario, then, when
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
    "../features/roles.feature",
    "Crear un rol con una selección parcial de permisos",
)
def test_create_role_partial_permissions():
    pass


@given("que existe un administrador con permisos completos de roles")
def admin_with_role_permissions(context):
    admin = User.objects.create_user(
        username="roles_admin_qa", email="roles_admin_qa@example.com", password="Sup3r-Secr3t!"
    )
    _grant(admin, "roles.ver", "roles.editar")
    context["client"] = APIClient()
    context["client"].force_authenticate(user=admin)


@when("el administrador crea un rol con un subconjunto de permisos del catálogo")
def create_role_with_subset(context):
    context["response"] = context["client"].post(
        "/api/v1/admin/roles/",
        {"name": "QA Subconjunto", "permission_codenames": ["usuarios.ver", "roles.ver"]},
        format="json",
    )


@then("el rol queda creado con exactamente esos permisos")
def role_created_with_exact_permissions(context):
    assert context["response"].status_code == 201
    assert sorted(context["response"].data["permission_codenames"]) == ["roles.ver", "usuarios.ver"]


@then('se registra un evento de auditoría "role.created"')
def role_created_audited(context):
    role_id = context["response"].data["id"]
    assert AuditLog.objects.filter(action="role.created", target_id=str(role_id)).exists()
