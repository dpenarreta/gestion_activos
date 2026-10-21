"""Todo empleado tiene su usuario (21/10/2026).

El alta del empleado crea la cuenta con el correo institucional, o la ata a la
que ya existe con ese correo; una cuenta es de un solo empleado. Ver
`apps/organizacion/cuentas.py`.
"""

import pytest
from rest_framework.test import APIClient

from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

pytestmark = pytest.mark.django_db

URL = "/api/v1/organizacion/empleados/"


@pytest.fixture
def cliente(db):
    admin = User.objects.create_superuser(
        username="admin_emp", email="admin_emp@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


def _datos(departamento, **cambios):
    return {
        "nombres": "Rosa",
        "apellidos": "Prueba",
        "correo": "rosa.prueba@grupolaar.com",
        "password": "Sup3r-Secr3t!",
        "departamento": departamento.id,
        **cambios,
    }


def test_crear_el_empleado_crea_su_usuario(cliente, departamento):
    respuesta = cliente.post(URL, _datos(departamento), format="json")
    assert respuesta.status_code == 201, respuesta.json()
    assert "password" not in respuesta.json()

    empleado = Empleado.objects.get(pk=respuesta.json()["id"])
    usuario = empleado.usuario
    assert usuario is not None
    assert usuario.email == "rosa.prueba@grupolaar.com"
    assert (usuario.first_name, usuario.last_name) == ("Rosa", "Prueba")
    assert usuario.must_change_password is True
    assert usuario.check_password("Sup3r-Secr3t!")
    assert respuesta.json()["usuario_username"] == usuario.username


def test_sin_correo_institucional_no_hay_empleado(cliente, departamento):
    sin_correo = cliente.post(URL, _datos(departamento, correo=""), format="json")
    assert sin_correo.status_code == 400
    ajeno = cliente.post(URL, _datos(departamento, correo="rosa@gmail.com"), format="json")
    assert ajeno.status_code == 400
    assert "institucional" in str(ajeno.json())
    assert not Empleado.objects.exists()


def test_una_cuenta_nueva_pide_contrasena_valida(cliente, departamento):
    assert cliente.post(URL, _datos(departamento, password=""), format="json").status_code == 400
    assert cliente.post(URL, _datos(departamento, password="123"), format="json").status_code == 400
    assert not User.objects.filter(email="rosa.prueba@grupolaar.com").exists()


def test_si_el_usuario_ya_existe_se_ata_sin_contrasena(cliente, departamento):
    existente = User.objects.create_user(
        username="rprueba", email="Rosa.Prueba@grupolaar.com", password="Otra-Cl4ve!"
    )
    respuesta = cliente.post(URL, _datos(departamento, password=""), format="json")
    assert respuesta.status_code == 201, respuesta.json()
    assert Empleado.objects.get().usuario == existente
    existente.refresh_from_db()
    assert existente.check_password("Otra-Cl4ve!")  # no se tocó


def test_una_cuenta_es_de_un_solo_empleado(cliente, departamento):
    assert cliente.post(URL, _datos(departamento), format="json").status_code == 201
    otro = cliente.post(URL, _datos(departamento, nombres="Otra", password=""), format="json")
    assert otro.status_code == 400
    assert "ya es de otro empleado" in str(otro.json())


def test_el_usuario_no_se_cambia_ni_se_suelta_por_la_api(cliente, departamento):
    creado = cliente.post(URL, _datos(departamento), format="json").json()
    cliente.patch(f"{URL}{creado['id']}/", {"usuario": None}, format="json")
    assert Empleado.objects.get(pk=creado["id"]).usuario_id == creado["usuario"]


def test_el_pendiente_se_completa_al_editarlo(cliente, departamento):
    pendiente = Empleado.objects.create(nombres="Ana", apellidos="Pérez", departamento=departamento)
    # Sin cuenta no se edita…
    sin = cliente.patch(f"{URL}{pendiente.id}/", {"cargo": "Analista"}, format="json")
    assert sin.status_code == 400
    # …pero sí se puede desactivar.
    assert (
        cliente.patch(f"{URL}{pendiente.id}/", {"activo": False}, format="json").status_code == 200
    )
    con = cliente.patch(
        f"{URL}{pendiente.id}/",
        {"correo": "ana.perez@grupolaar.com", "password": "Sup3r-Secr3t!"},
        format="json",
    )
    assert con.status_code == 200, con.json()
    pendiente.refresh_from_db()
    assert pendiente.usuario.email == "ana.perez@grupolaar.com"
