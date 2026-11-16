"""Un número de serie repetido en la empresa es un error junto al campo, no un
500 (16/11/2026, hallazgo de QA-FUNC en la US-023, alta desde la app).

La restricción `activo_serie_unica_por_empresa` no la ve el serializer
(`empresa` no es campo suyo) y el `IntegrityError` llegaba al manejador de
errores como «Ocurrió un error interno».
"""

import datetime

import pytest
from rest_framework import serializers
from rest_framework.test import APIClient

from apps.activos.models import Activo, TipoDispositivo
from apps.activos.services import ActivoService
from apps.empresas.models import Empresa
from apps.organizacion.models import Departamento
from apps.users.models import User

URL = "/api/v1/activos/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_serie", email="admin_serie@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Tecnología", codigo="TI")


@pytest.fixture
def tipo(db):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")


def _datos(tipo, area, serie, **extra):
    return {
        "tipo": tipo,
        "nombre": f"Laptop {serie}",
        "marca": "Dell",
        "modelo": "Latitude",
        "numero_serie": serie,
        "departamento": area,
        "fecha_adquisicion": datetime.date(2026, 1, 10),
        **extra,
    }


def _payload(tipo, area, serie):
    return {
        "tipo": tipo.id,
        "nombre": f"Laptop {serie}",
        "marca": "Dell",
        "modelo": "Latitude",
        "numero_serie": serie,
        "departamento": area.id,
        "fecha_adquisicion": "2026-01-10",
    }


def test_alta_con_serie_repetida_responde_400_en_el_campo(cliente, admin, tipo, area):
    ActivoService.crear_activo(actor=admin, **_datos(tipo, area, "SN-1"))

    respuesta = cliente.post(URL, _payload(tipo, area, "sn-1"), format="json")

    assert respuesta.status_code == 400, respuesta.content
    assert "numero_serie" in str(respuesta.json())
    assert Activo.objects.count() == 1


def test_editar_a_una_serie_ajena_responde_400(cliente, admin, tipo, area):
    ActivoService.crear_activo(actor=admin, **_datos(tipo, area, "SN-1"))
    otro = ActivoService.crear_activo(actor=admin, **_datos(tipo, area, "SN-2"))

    respuesta = cliente.patch(f"{URL}{otro.id}/", {"numero_serie": "SN-1"}, format="json")

    assert respuesta.status_code == 400, respuesta.content
    assert "numero_serie" in str(respuesta.json())
    otro.refresh_from_db()
    assert otro.numero_serie == "SN-2"


def test_editar_sin_cambiar_la_serie_sigue_funcionando(cliente, admin, tipo, area):
    activo = ActivoService.crear_activo(actor=admin, **_datos(tipo, area, "SN-1"))

    respuesta = cliente.patch(f"{URL}{activo.id}/", {"nombre": "Laptop renombrada"}, format="json")

    assert respuesta.status_code == 200, respuesta.content


def test_la_misma_serie_en_otra_empresa_si_se_puede(admin, tipo, area):
    empresa_a = Empresa.objects.first() or Empresa.objects.create(nombre="Laar", codigo="LAAR")
    empresa_b = Empresa.objects.create(nombre="Otra empresa", codigo="OTRA")
    ActivoService.crear_activo(actor=admin, **_datos(tipo, area, "SN-1", empresa=empresa_b))

    activo = ActivoService.crear_activo(
        actor=admin, **_datos(tipo, area, "SN-1", empresa=empresa_a)
    )

    assert activo.empresa_id == empresa_a.id

    with pytest.raises(serializers.ValidationError) as error:
        ActivoService.crear_activo(actor=admin, **_datos(tipo, area, "sn-1", empresa=empresa_a))
    assert "numero_serie" in error.value.detail
