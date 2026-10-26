"""El rol aceptado queda guardado (26/10/2026).

Al aceptar su rol de un mes, la persona se queda con ese rol: si nómina
cambia después los valores, se sigue viendo el aceptado (al consultarlo, en
el historial y en el rol auditado). La aceptación es definitiva. Y lo que se
guarda es lo que la persona vio: si nómina lo cambió entre que lo abrió y lo
aceptó, se le pide abrirlo de nuevo.
"""

import dataclasses
from decimal import Decimal

import pytest
from django.test import override_settings

from apps.nomina import aceptado, auditado, fuente, services
from apps.nomina.models import RolAceptado
from apps.nomina.tests.test_rol_pagos import BASE, CLAVE, _con_codigo, _consultar

URL = f"{BASE}conformidad/"


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


@pytest.fixture
def nomina_cambia(monkeypatch):
    """Desde que se activa, nómina devuelve el rol con un bono más."""
    original = fuente.obtener

    def cambiar():
        def obtener(codigo, anio, mes, empresa=""):
            rol = original(codigo, anio, mes, empresa)
            return dataclasses.replace(
                rol, ingresos=[*rol.ingresos, fuente.Rubro("Bono corregido", Decimal("40.00"))]
            )

        monkeypatch.setattr(fuente, "obtener", obtener)

    return cambiar


def _aceptar(cliente):
    consulta = _consultar(cliente)["X-Consulta-Rol"]
    respuesta = cliente.post(URL, {"consulta": consulta, "conformidad": "conforme"}, format="json")
    assert respuesta.status_code == 200, respuesta.data
    return consulta


def test_al_aceptar_se_guarda_el_rol_que_vio(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _aceptar(rosa)
    guardado = RolAceptado.objects.get()
    assert (guardado.codigo_empleado, guardado.anio, guardado.mes) == ("20100001", 2026, 9)
    rol = aceptado.de_dict(guardado.datos)
    assert rol.neto == fuente.obtener("20100001", 2026, 9).neto
    assert guardado.huella == aceptado.huella(rol)


def test_si_nomina_cambia_despues_se_sigue_viendo_el_aceptado(db, nomina_cambia):
    _, rosa = _con_codigo("rosa", "20100001")
    _aceptar(rosa)
    antes = aceptado.de_dict(RolAceptado.objects.get().datos)
    nomina_cambia()

    rol, guardado = aceptado.rol_del_periodo("20100001", 2026, 9)
    assert guardado is not None and rol.neto == antes.neto
    assert not any(r.nombre == "Bono corregido" for r in rol.ingresos)
    # Y la consulta dice que ya está aceptado.
    assert "X-Rol-Aceptado" in _consultar(rosa)
    # El historial de Talento Humano también es el aceptado.
    th, _ = _con_codigo("tatiana", "20100099", "roles_pago.historial")
    th.set_password(CLAVE)
    th.save()
    assert services.rol_desde_historial(th, "20100001", 2026, 9, CLAVE).startswith(b"%PDF")


def test_el_rol_auditado_dice_que_es_el_aceptado_y_si_nomina_difiere(db, nomina_cambia):
    _, rosa = _con_codigo("rosa", "20100001")
    _aceptar(rosa)
    guardado = RolAceptado.objects.get()
    assert "aceptó" in auditado._nota(guardado, "20100001", 2026, 9, services._nombre_empresa())
    assert "distintos" not in auditado._nota(
        guardado, "20100001", 2026, 9, services._nombre_empresa()
    )
    nomina_cambia()
    assert "valores distintos" in auditado._nota(
        guardado, "20100001", 2026, 9, services._nombre_empresa()
    )


def test_si_nomina_cambio_desde_que_lo_abrio_no_se_acepta(db, nomina_cambia):
    _, rosa = _con_codigo("rosa", "20100001")
    consulta = _consultar(rosa)["X-Consulta-Rol"]
    nomina_cambia()
    respuesta = rosa.post(URL, {"consulta": consulta, "conformidad": "conforme"}, format="json")
    assert respuesta.status_code == 400 and "cambió" in str(respuesta.data)
    assert not RolAceptado.objects.exists()
    # Al abrirlo de nuevo ve el actual y ese sí lo puede aceptar.
    _aceptar(rosa)
    rol = aceptado.de_dict(RolAceptado.objects.get().datos)
    assert any(r.nombre == "Bono corregido" for r in rol.ingresos)


def test_una_observacion_no_guarda_el_rol(db):
    _, rosa = _con_codigo("rosa", "20100001")
    consulta = _consultar(rosa)["X-Consulta-Rol"]
    rosa.post(
        URL,
        {"consulta": consulta, "conformidad": "observacion", "observacion": "Faltan horas."},
        format="json",
    )
    assert not RolAceptado.objects.exists()
    assert "X-Rol-Aceptado" not in _consultar(rosa)
