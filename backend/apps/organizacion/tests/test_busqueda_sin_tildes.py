"""Los catálogos de la organización se buscan sin tildes ni mayúsculas, cada
palabra en cualquier orden (ver `apps.core.busqueda`)."""

import pytest
from rest_framework.test import APIClient

from apps.organizacion.models import Concesionario, Departamento, Empleado, Proveedor, Sede
from apps.users.models import User

BASE = "/api/v1/organizacion"


@pytest.fixture
def cliente(db):
    admin = User.objects.create_superuser(
        username="admin_org_tildes", email="admin_org_tildes@example.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def _buscar(cliente, recurso, termino, campo="nombre"):
    respuesta = cliente.get(f"{BASE}/{recurso}/", {"q": termino})
    assert respuesta.status_code == 200, respuesta.data
    return [fila[campo] for fila in respuesta.data["results"]]


def test_departamentos(cliente):
    Departamento.objects.create(nombre="Logística", codigo="LOG")
    Departamento.objects.create(nombre="Finanzas", codigo="FIN")
    assert _buscar(cliente, "departamentos", "LOGISTICA") == ["Logística"]


def test_sedes_por_ciudad_y_nombre_en_cualquier_orden(cliente):
    Sede.objects.create(nombre="Bodega Norte", ciudad="Quito")
    Sede.objects.create(nombre="Agencia Peñón", ciudad="Ambato")
    Sede.objects.create(nombre="Bodega Sur", ciudad="Quito")
    assert _buscar(cliente, "sedes", "norte quito") == ["Bodega Norte"]
    assert _buscar(cliente, "sedes", "penon") == ["Agencia Peñón"]


def test_empleados(cliente):
    area = Departamento.objects.create(nombre="Operaciones", codigo="OPE")
    Empleado.objects.create(
        nombres="ÑANDÚ", apellidos="Ramírez", codigo_empleado="OPE-1", departamento=area
    )
    Empleado.objects.create(
        nombres="Ana", apellidos="Cevallos", codigo_empleado="OPE-2", departamento=area
    )
    assert _buscar(cliente, "empleados", "nandu", "codigo_empleado") == ["OPE-1"]
    assert _buscar(cliente, "empleados", "ramirez ñandu", "codigo_empleado") == ["OPE-1"]


def test_proveedores(cliente):
    Proveedor.objects.create(nombre="Compañía Andina de Cómputo", contacto="Raúl Ibáñez")
    Proveedor.objects.create(nombre="Suministros del Pacífico")
    assert _buscar(cliente, "proveedores", "raul compania") == ["Compañía Andina de Cómputo"]


def test_concesionarios(cliente):
    Concesionario.objects.create(nombre="Logística Austral", contacto="Inés Muñoz")
    Concesionario.objects.create(nombre="Transportes Andes")
    assert _buscar(cliente, "concesionarios", "munoz") == ["Logística Austral"]
