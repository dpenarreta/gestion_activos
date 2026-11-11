"""La contraseña del rol de pagos cuenta para el bloqueo del inicio de sesión.

Auditoría de seguridad, 29/10/2026: cada pantalla del rol de pagos validaba la
contraseña por su cuenta y solo la frenaba el throttling, así que servía para
adivinarla sin tocar el bloqueo del login.

Desde US-002 (11/11/2026) la consulta del propio rol ya no pide la contraseña
sino un código que llega al correo: sus fallos no tocan el inicio de sesión (el
código se anula a los 5 intentos y los envíos están limitados). Las pantallas
que siguen con contraseña (historial, descarga masiva, auditado) sí cuentan.
"""

import datetime

import pytest
from django.conf import settings
from django.core.cache import cache
from django.db.models import F

from apps.authentication.models import LoginAttempt
from apps.authentication.services import LOCKOUT_ERROR, AuthenticationService
from apps.nomina.models import CodigoConsultaRol
from apps.nomina.tests.test_rol_pagos import (  # noqa: F401
    BASE,
    CLAVE,
    _codigo_del_correo,
    _con_codigo,
    _consultar,
    _ejemplo,
    _otro,
    _pedir_codigo,
    _version,
)


def _confirmar(cliente, escrito):
    datos = {
        "anio": 2026,
        "mes": 9,
        "acepto": True,
        "version": _version(cliente),
        "codigo_verificacion": escrito,
    }
    return cliente.post(f"{BASE}consultar/", datos, format="json")


pytestmark = pytest.mark.django_db


def test_los_fallos_del_codigo_no_bloquean_el_inicio_de_sesion(db):
    usuario, rosa = _con_codigo("rosa", "20100001")
    for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS + 1):
        # Pide un código y escribe otro de 6 dígitos que no coincide.
        cache.clear()
        CodigoConsultaRol.objects.todas().update(
            creado_en=F("creado_en") - datetime.timedelta(hours=1)
        )
        assert _pedir_codigo(rosa).status_code == 200
        distinto = _otro(_codigo_del_correo())
        respuesta = _confirmar(rosa, distinto)
        assert respuesta.status_code == 400
        assert respuesta.json()["error"]["details"] == {
            "codigo_verificacion": "El código no es correcto."
        }

    assert not LoginAttempt.objects.filter(identifier=usuario.username, successful=False).exists()
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier=usuario.username, password=CLAVE, ip_address="127.0.0.1"
    )
    assert tokens
    # Y con un código nuevo, bien escrito, el rol se abre.
    assert _consultar(rosa).status_code == 200


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
