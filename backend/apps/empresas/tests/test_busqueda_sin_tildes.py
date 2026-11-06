"""El listado de empresas atiende `?q=`, sin tildes ni mayúsculas.

La pantalla ya mandaba lo escrito y el servidor lo ignoraba: el buscador no
filtraba nada (ver `apps.core.busqueda`).
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.empresas.models import Empresa
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def cliente():
    usuario = User.objects.create_user(
        username="lectora", email="lectora@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename="empresas.ver",
        )
    )
    client = APIClient()
    client.force_authenticate(user=usuario)
    return client


def _buscar(cliente, termino):
    respuesta = cliente.get("/api/v1/empresas/", {"q": termino})
    assert respuesta.status_code == 200
    return [fila["nombre"] for fila in respuesta.data["results"]]


def test_compania_encuentra_compania_con_enie(cliente):
    Empresa.objects.create(nombre="Compañía Logística del Sur", codigo="CLS")
    Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    assert _buscar(cliente, "compania logistica") == ["Compañía Logística del Sur"]
    assert _buscar(cliente, "SUR compañia") == ["Compañía Logística del Sur"]


def test_sin_texto_se_listan_todas(cliente):
    Empresa.objects.create(nombre="Compañía Logística del Sur", codigo="CLS")
    Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    assert {"Compañía Logística del Sur", "LaarCourier"} <= set(_buscar(cliente, ""))
