"""La lista de habilitados del rol de pagos y «Mis observaciones» (22/10/2026).

Consultar el rol de pagos no se da por rol ni por cargo: se habilita persona
por persona (`roles_pago.consultar`), y lo gestiona nómina
(`roles_pago.habilitar`), que también edita el código de empleado.
"""

import pytest
from django.test import override_settings

from apps.nomina.tests.test_rol_pagos import BASE, _consultar
from apps.organizacion.tests.test_carga_personas import _cuenta

HABILITADOS = f"{BASE}habilitados/"


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


def test_nomina_habilita_con_su_codigo_y_quien_no_esta_no_consulta(db):
    rosa, cliente_rosa = _cuenta("rosa")
    _, nomina = _cuenta("nomina", "roles_pago.habilitar")

    assert cliente_rosa.get(BASE).status_code == 403  # no está en la lista
    assert _cuenta("otro")[1].get(HABILITADOS).status_code == 403  # no gestiona

    sin_codigo = nomina.post(HABILITADOS, {"usuario": rosa.id, "habilitado": True}, format="json")
    assert sin_codigo.status_code == 400

    fila = nomina.post(
        HABILITADOS,
        {"usuario": rosa.id, "habilitado": True, "codigo": "20100001"},
        format="json",
    ).json()
    assert fila == {
        "id": rosa.id,
        "nombre": "Rosa Prueba",
        "correo": rosa.email,
        "codigo": "20100001",
        "habilitado": True,
    }
    lista = nomina.get(HABILITADOS).json()
    assert lista[0]["id"] == rosa.id and lista[0]["habilitado"] is True

    rosa_de_nuevo = type(rosa).objects.get(pk=rosa.pk)
    cliente_rosa.force_authenticate(user=rosa_de_nuevo)
    estado = cliente_rosa.get(BASE).json()
    assert estado["habilitado"] is True and estado["codigo"] == "20100001"

    nomina.post(HABILITADOS, {"usuario": rosa.id, "habilitado": False}, format="json")
    cliente_rosa.force_authenticate(user=type(rosa).objects.get(pk=rosa.pk))
    assert cliente_rosa.get(BASE).status_code == 403


def test_quien_gestiona_abre_la_pantalla_aunque_no_este_habilitado(db):
    _, nomina = _cuenta("nomina", "roles_pago.habilitar")
    estado = nomina.get(BASE).json()
    assert estado["habilitado"] is False and estado["puede_habilitar"] is True


def test_cada_persona_ve_solo_sus_observaciones_en_todos_sus_estados(db):
    rosa, cliente_rosa = _cuenta("rosa", "roles_pago.consultar")
    rosa.codigo_empleado = "20100001"
    rosa.save()
    beto, cliente_beto = _cuenta("beto", "roles_pago.consultar")
    beto.codigo_empleado = "20100002"
    beto.save()

    consulta = _consultar(cliente_rosa)["X-Consulta-Rol"]
    cliente_rosa.post(
        f"{BASE}conformidad/",
        {"consulta": consulta, "conformidad": "observacion", "observacion": "Faltan horas."},
        format="json",
    )
    mias = cliente_rosa.get(f"{BASE}mis-observaciones/").json()
    assert len(mias) == 1 and mias[0]["estado"] == "abierta"
    assert mias[0]["mensajes"][0]["texto"] == "Faltan horas."
    assert cliente_beto.get(f"{BASE}mis-observaciones/").json() == []
