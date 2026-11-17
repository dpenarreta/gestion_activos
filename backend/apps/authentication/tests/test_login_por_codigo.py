"""Iniciar sesión con usuario, correo o código de empleado (17/11/2026).

El correo es el que la cuenta tiene ahora: si se cambió en el primer
ingreso, vale el nuevo. Y el bloqueo por intentos suma los fallos de la
cuenta con cualquiera de los tres, para que alternarlos no dé más intentos.
"""

import pytest
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed

from apps.authentication.services import AuthenticationService, BruteForceProtectionService

pytestmark = pytest.mark.django_db

CLAVE = "Sup3r-Secr3t!"


@pytest.fixture
def daniel():
    usuario = AuthenticationService.register_user(
        username="dpenarreta", email="dpenarreta@grupolaar.com", password=CLAVE
    )
    usuario.codigo_empleado = "20104758"
    usuario.save(update_fields=["codigo_empleado"])
    return usuario


@pytest.mark.parametrize("identificador", ["dpenarreta", "DPenarreta@grupolaar.com", "20104758"])
def test_entra_con_usuario_correo_o_codigo(daniel, identificador):
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier=f"  {identificador} ", password=CLAVE
    )
    assert "access" in tokens


def test_tras_cambiar_el_correo_vale_el_nuevo_y_no_el_anterior(daniel):
    daniel.email = "daniel.penarreta@grupolaar.com"
    daniel.save(update_fields=["email"])

    assert "access" in AuthenticationService.authenticate_and_issue_tokens(
        identifier="daniel.penarreta@grupolaar.com", password=CLAVE
    )
    with pytest.raises(AuthenticationFailed):
        AuthenticationService.authenticate_and_issue_tokens(
            identifier="dpenarreta@grupolaar.com", password=CLAVE
        )


def test_el_usuario_gana_si_coincide_con_el_codigo_de_otra_cuenta(daniel):
    otro = AuthenticationService.register_user(
        username="20104758", email="otro@grupolaar.com", password="0tra-Clave!2026"
    )
    assert AuthenticationService._resolve_user("20104758") == otro


def test_alternar_identificadores_no_da_mas_intentos(daniel):
    ip = "10.0.0.9"
    identificadores = ["dpenarreta", "dpenarreta@grupolaar.com", "20104758"]
    for i in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        with pytest.raises(AuthenticationFailed):
            AuthenticationService.authenticate_and_issue_tokens(
                identifier=identificadores[i % 3], password="mala", ip_address=ip
            )

    assert BruteForceProtectionService.cuenta_bloqueada(daniel, ip)
    with pytest.raises(AuthenticationFailed) as error:
        AuthenticationService.authenticate_and_issue_tokens(
            identifier="20104758", password=CLAVE, ip_address=ip
        )
    assert error.value.detail.code == "account_locked"

    # Desbloquear desde Configuración lo levanta.
    BruteForceProtectionService.desbloquear(daniel)
    assert "access" in AuthenticationService.authenticate_and_issue_tokens(
        identifier="20104758", password=CLAVE, ip_address=ip
    )
