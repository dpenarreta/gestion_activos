"""Fixtures de derechos sobre datos personales.

Como en las pruebas de Mejora continua:

- Cada prueba corre dentro de una empresa (fixture global de `backend/conftest.py`).
- Cada cuenta que se crea nace con membresía en esa empresa (sin roles); los
  permisos se dan con roles globales (`user.groups`) o directos.

Los datos son ficticios, con tildes y eñes, sin datos reales.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.db.models.signals import post_save
from rest_framework.test import APIClient

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

BASE = "/api/v1/privacidad"


def _unir_a_la_empresa(sender, instance, created, **kwargs):
    empresa = empresa_actual()
    if not created or empresa is None or empresa is SIN_EMPRESA:
        return
    MembresiaEmpresa.objects.get_or_create(
        usuario=instance, empresa=empresa, defaults={"es_predeterminada": True}
    )


@pytest.fixture(autouse=True)
def _cuentas_de_la_empresa(db):
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="privacidad_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="privacidad_tests_unir")


def make_user(username: str, *, role: str | None = None, perms=(), **extra) -> User:
    datos = {"first_name": username.title(), **extra}
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        **datos,
    )
    if role:
        user.groups.set([Group.objects.get(name=role)])
    for codename in perms:
        user.user_permissions.add(
            Permission.objects.get(content_type__app_label="permissions", codename=codename)
        )
    return user


def client_for(user: User) -> APIClient:
    """Cliente con la cuenta recién leída (los permisos se memorizan)."""
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


@pytest.fixture
def begona():
    """Titular: una cuenta sin ningún permiso."""
    return make_user("bpenaherrera", first_name="Begoña", last_name="Peñaherrera")


@pytest.fixture
def nunez():
    """Otra persona de la empresa, sin permisos."""
    return make_user("anunez", first_name="Ana", last_name="Núñez")


@pytest.fixture
def admin_gh():
    """Atiende: el Administrador de Gestión Humana (`privacidad/0002`)."""
    return make_user("admingh", role=ADMIN_GH, first_name="Adela", last_name="Ibáñez")


@pytest.fixture
def lectora():
    """Solo ve la bandeja (`privacidad.ver`)."""
    return make_user("lectora", perms=["privacidad.ver"], first_name="Lucía")
