"""El listado administrativo de usuarios se busca sin tildes ni mayúsculas
(ver `apps.core.busqueda`)."""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def cliente():
    admin = User.objects.create_user(
        username="admin_tildes", email="admin_tildes@example.com", password="Sup3r-Secr3t!"
    )
    admin.user_permissions.add(
        *Permission.objects.filter(content_type=ContentType.objects.get_for_model(ModulePermission))
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def _usuario(username, first_name, last_name):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name=first_name,
        last_name=last_name,
    )


def _buscar(cliente, termino):
    respuesta = cliente.get("/api/v1/admin/users/", {"q": termino})
    assert respuesta.status_code == 200
    return sorted(fila["username"] for fila in respuesta.data["results"])


def test_ramirez_encuentra_a_ramirez_con_tilde(cliente):
    _usuario("jramirez", "José", "Ramírez")
    _usuario("acevallos", "Ana", "Cevallos")
    assert _buscar(cliente, "ramirez") == ["jramirez"]
    assert _buscar(cliente, "RAMÍREZ") == ["jramirez"]


def test_nombre_y_apellido_en_cualquier_orden(cliente):
    _usuario("jramirez", "José", "Ramírez")
    _usuario("jcevallos", "José", "Cevallos")
    assert _buscar(cliente, "ramirez jose") == ["jramirez"]
    assert _buscar(cliente, "ÑANDÚ") == []


def test_el_id_se_sigue_buscando_con_el_numero_entero(cliente):
    usuario = _usuario("nandu", "Ñandú", "Paz")
    assert _buscar(cliente, str(usuario.id)) == ["nandu"]
    assert _buscar(cliente, "nandu") == ["nandu"]
