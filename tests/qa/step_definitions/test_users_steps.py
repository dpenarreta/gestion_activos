"""Step definitions de tests/qa/features/users.feature — cubre en particular
AC-038 (protección del último administrador activo), el criterio nuevo con
mayor riesgo por no existir en el proyecto original."""

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


def _grant_all(user):
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(*Permission.objects.filter(content_type=content_type))


@scenario(
    "../features/users.feature",
    "No se puede deshabilitar al último administrador activo",
)
def test_cannot_disable_last_admin():
    pass


@scenario(
    "../features/users.feature",
    "Sí se puede deshabilitar a un administrador si existe otro activo",
)
def test_can_disable_admin_when_another_exists():
    pass


@given("que existe un administrador con permisos completos de usuarios")
def admin_with_full_permissions(context):
    admin = User.objects.create_user(
        username="qa_admin", email="qa_admin@example.com", password="Sup3r-Secr3t!"
    )
    _grant_all(admin)
    context["actor_client"] = APIClient()
    context["actor_client"].force_authenticate(user=admin)


@given("que existe un único administrador activo (superusuario) en el sistema")
def single_active_superuser(context):
    admin = User.objects.create_user(
        username="only_admin",
        email="only_admin@example.com",
        password="Sup3r-Secr3t!",
        is_superuser=True,
    )
    context["target"] = admin


@given("que existen dos administradores activos")
def two_active_superusers(context):
    admin1 = User.objects.create_user(
        username="admin_one", email="admin_one@example.com", password="Sup3r-Secr3t!", is_superuser=True
    )
    User.objects.create_user(
        username="admin_two", email="admin_two@example.com", password="Sup3r-Secr3t!", is_superuser=True
    )
    context["target"] = admin1


@when("se intenta deshabilitar a ese administrador")
def try_disable_target(context):
    context["response"] = context["actor_client"].post(
        f"/api/v1/admin/users/{context['target'].id}/disable/"
    )


@when("se deshabilita a uno de ellos")
def disable_one_of_two(context):
    context["response"] = context["actor_client"].post(
        f"/api/v1/admin/users/{context['target'].id}/disable/"
    )


@then("el sistema rechaza la operación")
def rejects_operation(context):
    assert context["response"].status_code == 400


@then("el administrador permanece activo")
def admin_remains_active(context):
    context["target"].refresh_from_db()
    assert context["target"].status == User.Status.ACTIVE


@then("la operación se completa correctamente")
def operation_succeeds(context):
    assert context["response"].status_code == 200


@then("el otro administrador sigue activo")
def other_admin_still_active(context):
    other = User.objects.exclude(id=context["target"].id).get(is_superuser=True)
    assert other.status == User.Status.ACTIVE
