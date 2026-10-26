"""Reglas de las contraseñas y clave temporal (26/10/2026).

- Mínimo 8 caracteres, con al menos una mayúscula, un número y un signo
  especial.
- Las cuentas que se crean sin escribir contraseña nacen con la clave
  temporal del entorno (`CLAVE_INICIAL_USUARIOS`, en el .env; aquí, una
  inventada), que solo sirve para el primer ingreso: toda cuenta nueva queda
  obligada a cambiarla, y la nueva no puede ser la temporal. Sin clave
  temporal configurada, el alta pide escribir una.
"""

import pytest
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.users.models import User

pytestmark = pytest.mark.django_db

TEMPORAL = "Clave-De-Prueba9!"


@pytest.fixture(autouse=True)
def _con_clave_temporal(settings):
    settings.CLAVE_INICIAL_USUARIOS = TEMPORAL


@pytest.mark.parametrize(
    "clave, falta",
    [
        ("Ab1!xyz", "8 caracteres"),
        ("minuscula1!", "mayúscula"),
        ("SinNumero!", "número"),
        ("SinSigno123", "signo especial"),
        ("solominusculas", "mayúscula, un número y un signo especial"),
    ],
)
def test_lo_que_no_cumple_las_reglas_se_rechaza(clave, falta):
    with pytest.raises(ValidationError) as error:
        validate_password(clave)
    assert falta in " ".join(error.value.messages)


@pytest.mark.parametrize("clave", ["Laar2026#", "Cl4ve-Propia", "Quito.Norte9"])
def test_lo_que_cumple_las_reglas_se_acepta(clave):
    validate_password(clave)


def test_la_clave_temporal_no_sirve_como_contrasena_propia():
    with pytest.raises(ValidationError) as error:
        validate_password(TEMPORAL)
    assert "clave temporal" in " ".join(error.value.messages)


def _admin():
    admin = User.objects.create_superuser(
        username="admin_claves", email="admin_claves@example.com", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.force_authenticate(user=admin)
    return cliente


def _alta(cliente, **extra):
    return cliente.post(
        "/api/v1/admin/users/",
        {"email": "nueva@grupolaar.com", "first_name": "Nueva", "last_name": "Persona", **extra},
        format="json",
    )


def test_el_alta_sin_contrasena_usa_la_temporal_y_obliga_a_cambiarla():
    respuesta = _alta(_admin())
    assert respuesta.status_code == 201, respuesta.data
    usuario = User.objects.get(email="nueva@grupolaar.com")
    assert usuario.check_password(TEMPORAL)
    assert usuario.must_change_password is True


def test_el_alta_con_contrasena_tambien_obliga_a_cambiarla():
    respuesta = _alta(_admin(), password="Inicial#2026")
    assert respuesta.status_code == 201, respuesta.data
    usuario = User.objects.get(email="nueva@grupolaar.com")
    assert usuario.check_password("Inicial#2026")
    assert usuario.must_change_password is True


def test_en_el_alta_una_contrasena_escrita_debe_cumplir_las_reglas():
    assert _alta(_admin(), password="debil").status_code == 400
    assert not User.objects.filter(email="nueva@grupolaar.com").exists()


def test_sin_clave_temporal_configurada_el_alta_pide_escribir_una(settings):
    settings.CLAVE_INICIAL_USUARIOS = ""
    respuesta = _alta(_admin())
    assert respuesta.status_code == 400
    assert "no hay una clave temporal configurada" in str(respuesta.data)
