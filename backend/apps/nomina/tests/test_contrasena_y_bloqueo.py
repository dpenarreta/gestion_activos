"""La contraseña del rol de pagos cuenta para el bloqueo del inicio de sesión.

Auditoría de seguridad, 29/10/2026: cada pantalla del rol de pagos validaba la
contraseña por su cuenta y solo la frenaba el throttling, así que servía para
adivinarla sin tocar el bloqueo del login.
"""

import pytest
from django.conf import settings
from django.core.cache import cache

from apps.authentication.models import LoginAttempt
from apps.authentication.services import LOCKOUT_ERROR, AuthenticationService
from apps.nomina.tests.test_rol_pagos import CLAVE, _con_codigo, _consultar, _ejemplo  # noqa: F401

pytestmark = pytest.mark.django_db


def test_los_fallos_de_la_consulta_quedan_como_intentos_fallidos(db):
    usuario, rosa = _con_codigo("rosa", "20100001")

    assert _consultar(rosa, password="otra").status_code == 403

    assert LoginAttempt.objects.filter(
        identifier=usuario.username, user=usuario, successful=False
    ).exists()


def test_agotados_los_intentos_ni_la_clave_buena_abre_el_rol(db):
    _, rosa = _con_codigo("rosa", "20100001")
    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        assert _consultar(rosa, password="otra").status_code == 403
    cache.clear()  # que no sea el throttling quien lo frene

    respuesta = _consultar(rosa)

    assert respuesta.status_code == 403
    assert LOCKOUT_ERROR in str(respuesta.json())


def test_y_tambien_cuentan_para_el_inicio_de_sesion(db):
    usuario, rosa = _con_codigo("rosa", "20100001")
    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        _consultar(rosa, password="otra")

    from rest_framework.exceptions import AuthenticationFailed

    with pytest.raises(AuthenticationFailed) as error:
        AuthenticationService.authenticate_and_issue_tokens(
            identifier=usuario.username, password=CLAVE, ip_address="127.0.0.1"
        )
    assert str(error.value.detail) == LOCKOUT_ERROR


def test_desde_el_historial_tambien_cuentan(db):
    _, th = _con_codigo("tatiana", "20100099", "roles_pago.historial")
    url = "/api/v1/nomina/historial/rol/"
    datos = {"codigo": "20100001", "anio": 2026, "mes": 9, "password": "otra"}
    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
        assert th.post(url, datos, format="json").status_code == 403
    cache.clear()

    respuesta = th.post(url, {**datos, "password": CLAVE}, format="json")

    assert respuesta.status_code == 403
    assert LOCKOUT_ERROR in str(respuesta.json())
