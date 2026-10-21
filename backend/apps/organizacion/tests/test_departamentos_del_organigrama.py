"""El organigrama manda sobre los departamentos (21/10/2026).

Cada unidad del organigrama es un departamento: se crea, renombra y desactiva
con ella. Ver `apps/organizacion/departamentos_del_organigrama.py`.
"""

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.organizacion.models import (
    Departamento,
    Empleado,
    NivelJerarquico,
    UnidadOrganizacional,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db

URL = "/api/v1/organizacion/unidades/"


@pytest.fixture
def cliente(db):
    admin = User.objects.create_superuser(
        username="admin_org", email="admin_org@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def nivel(db):
    return NivelJerarquico.objects.create(nombre="Gerencia", orden=1)


def test_crear_una_unidad_crea_su_departamento(cliente, nivel):
    respuesta = cliente.post(
        URL, {"nombre": "Servicio al Cliente", "nivel": nivel.id}, format="json"
    )
    assert respuesta.status_code == 201, respuesta.json()
    unidad = UnidadOrganizacional.objects.get(pk=respuesta.json()["id"])
    assert unidad.departamento.nombre == "Servicio al Cliente"
    assert unidad.departamento.codigo == "SAC"
    assert respuesta.json()["departamento"] == unidad.departamento_id


def test_el_codigo_de_la_unidad_manda_y_no_se_repite(cliente, nivel):
    Departamento.objects.create(nombre="Otra", codigo="TI")
    respuesta = cliente.post(
        URL, {"nombre": "Tecnología", "codigo": "ti", "nivel": nivel.id}, format="json"
    )
    assert UnidadOrganizacional.objects.get(pk=respuesta.json()["id"]).departamento.codigo == "TI2"


def test_renombrar_o_desactivar_la_unidad_lo_hace_con_su_departamento(cliente, nivel):
    unidad_id = cliente.post(URL, {"nombre": "Ventas", "nivel": nivel.id}, format="json").json()[
        "id"
    ]
    cliente.patch(f"{URL}{unidad_id}/", {"nombre": "Comercial", "activa": False}, format="json")
    departamento = UnidadOrganizacional.objects.get(pk=unidad_id).departamento
    assert (departamento.nombre, departamento.activo) == ("Comercial", False)
    assert departamento.codigo == "VEN"  # el código no cambia solo: numera etiquetas


def test_un_departamento_con_el_mismo_nombre_se_reutiliza(cliente, nivel):
    existente = Departamento.objects.create(nombre="Contabilidad", codigo="CTB")
    respuesta = cliente.post(URL, {"nombre": "Contabilidad", "nivel": nivel.id}, format="json")
    assert UnidadOrganizacional.objects.get(pk=respuesta.json()["id"]).departamento == existente
    assert Departamento.objects.count() == 1


def test_borrar_la_unidad_desactiva_su_departamento(cliente, nivel):
    unidad_id = cliente.post(URL, {"nombre": "Temporal", "nivel": nivel.id}, format="json").json()[
        "id"
    ]
    departamento_id = UnidadOrganizacional.objects.get(pk=unidad_id).departamento_id
    assert cliente.delete(f"{URL}{unidad_id}/").status_code == 204
    assert Departamento.objects.get(pk=departamento_id).activo is False


def test_el_comando_une_lo_existente_sin_perder_empleados(nivel):
    raiz = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=nivel)
    area = NivelJerarquico.objects.create(nombre="Área", orden=2)
    UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=area, padre=raiz)
    UnidadOrganizacional.objects.create(nombre="Gestión Humana", nivel=area, padre=raiz)
    ti = Departamento.objects.create(nombre="Tecnología", codigo="TI")
    th = Departamento.objects.create(nombre="Talento Humano", codigo="TTH")
    ctb = Departamento.objects.create(nombre="Contabilidad", codigo="CTB")
    empleado = Empleado.objects.create(nombres="Ana", apellidos="Pérez", departamento=ctb)

    call_command("unir_departamentos_organigrama", equivale=["Talento Humano=Gestión Humana"])
    call_command("unir_departamentos_organigrama")  # repetirlo no duplica

    assert UnidadOrganizacional.objects.get(nombre="Tecnología").departamento == ti
    assert UnidadOrganizacional.objects.get(nombre="Gestión Humana").departamento == th
    th.refresh_from_db()
    assert (th.nombre, th.codigo) == ("Gestión Humana", "TTH")
    nueva = UnidadOrganizacional.objects.get(departamento=ctb)
    assert nueva.padre == raiz and nueva.nivel == area and "Por ubicar" in nueva.descripcion
    assert UnidadOrganizacional.objects.count() == 4
    assert UnidadOrganizacional.objects.filter(departamento=None).count() == 0
    empleado.refresh_from_db()
    assert empleado.departamento == ctb and empleado.codigo_empleado.startswith("CTB-")
