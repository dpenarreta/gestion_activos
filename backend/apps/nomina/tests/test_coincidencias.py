"""Sugerir el código de empleado al crear un usuario (17/11/2026).

Se buscan los nombres y apellidos escritos en la lista de nómina; si hay
varias coincidencias se muestran todas para elegir. Nunca se devuelve la
cédula.
"""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.nomina import empleados
from apps.users.models import User

pytestmark = pytest.mark.django_db
URL = "/api/v1/nomina/coincidencias/"

NOMINA = [
    empleados.Empleado(
        "20104758", "Daniel Patricio", "Peñarreta Feijoo", "dpenarreta@grupolaar.com", "0102030405"
    ),
    empleados.Empleado("20100001", "Daniel Andrés", "Peñarreta Ruiz", "", "0102030406"),
    empleados.Empleado(
        "20100002", "Fernanda", "Marroquín Vera", "fmarroquin@grupolaar.com", "0102030407"
    ),
]


@pytest.fixture(autouse=True)
def nomina(monkeypatch, settings):
    settings.NOMINA_EMPLEADOS_PROCEDIMIENTO = "dbo.sp_ObtenerEmpleadosActivos"
    cache.delete(empleados.CACHE_SUGERENCIAS)
    monkeypatch.setattr(empleados, "leer", lambda: NOMINA)
    yield
    cache.delete(empleados.CACHE_SUGERENCIAS)


@pytest.fixture
def admin():
    usuario = User.objects.create_superuser(
        username="admin_coinc", email="admin_coinc@grupolaar.com", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


def test_una_coincidencia_sin_tildes_ni_mayusculas(admin):
    datos = admin.get(URL, {"nombres": "fernanda", "apellidos": "MARROQUIN"}).json()
    assert datos["configurada"] is True
    assert [r["codigo"] for r in datos["resultados"]] == ["20100002"]
    assert "cedula" not in datos["resultados"][0]


def test_varias_coincidencias_se_muestran_todas_y_dice_si_ya_tienen_cuenta(admin):
    User.objects.create_user(
        username="dpenarreta",
        email="dpenarreta@grupolaar.com",
        password="x",
        codigo_empleado="20104758",
    )
    resultados = admin.get(URL, {"nombres": "Daniel", "apellidos": "Peñarreta"}).json()[
        "resultados"
    ]
    assert {r["codigo"]: r["asignado_a"] for r in resultados} == {
        "20104758": "dpenarreta",
        "20100001": None,
    }


def test_con_una_sola_palabra_no_busca(admin):
    assert admin.get(URL, {"nombres": "Daniel", "apellidos": ""}).json()["resultados"] == []


def test_pide_permiso_para_crear_o_editar_usuarios():
    usuario = User.objects.create_user(
        username="sinperm", email="sinperm@grupolaar.com", password="x"
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    assert cliente.get(URL, {"nombres": "Daniel", "apellidos": "Peñarreta"}).status_code == 403
