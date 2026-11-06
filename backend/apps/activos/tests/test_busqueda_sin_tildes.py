"""El inventario y los tipos de equipo se buscan sin tildes ni mayúsculas.

Hallazgo de la auditoría (06/11/2026): «ramirez» no encontraba los equipos a
cargo de «Ramírez», mientras las listas que filtran en el navegador sí. Ver
`apps.core.busqueda`.
"""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.users.models import User

ACTIVOS = "/api/v1/activos/"
TIPOS = "/api/v1/activos/tipos/"


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_tildes", email="admin_tildes@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def area(db):
    return Departamento.objects.create(nombre="Logística", codigo="LOG")


@pytest.fixture
def escaner(db):
    return TipoDispositivo.objects.create(nombre="Escáner", codigo="ESC")


def _persona(area, nombres, apellidos, codigo):
    return Empleado.objects.create(
        nombres=nombres, apellidos=apellidos, codigo_empleado=codigo, departamento=area
    )


def _equipo(admin, tipo, area, *, nombre, marca, serie, responsables=(), compartido=False):
    return ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre=nombre,
        marca=marca,
        modelo="Modelo 1",
        numero_serie=serie,
        departamento=area,
        fecha_adquisicion=datetime.date(2025, 3, 1),
        compartido=compartido,
        responsables=list(responsables),
    )


def _series(respuesta):
    assert respuesta.status_code == 200, respuesta.data
    return [fila["numero_serie"] for fila in respuesta.data["results"]]


def test_ramirez_encuentra_el_equipo_a_cargo_de_ramirez_con_tilde(cliente, admin, escaner, area):
    ramirez = _persona(area, "José", "Ramírez", "LOG-1")
    _equipo(
        admin,
        escaner,
        area,
        nombre="Escáner de andén",
        marca="Zebra",
        serie="S-1",
        responsables=[ramirez],
    )
    _equipo(admin, escaner, area, nombre="Escáner de bodega", marca="Honeywell", serie="S-2")

    assert _series(cliente.get(ACTIVOS, {"q": "ramirez"})) == ["S-1"]
    assert _series(cliente.get(ACTIVOS, {"q": "RAMÍREZ"})) == ["S-1"]


def test_las_palabras_van_en_cualquier_orden_y_en_cualquier_campo(cliente, admin, escaner, area):
    ramirez = _persona(area, "José", "Ramírez", "LOG-1")
    _equipo(
        admin,
        escaner,
        area,
        nombre="Escáner de andén",
        marca="Zebra",
        serie="S-1",
        responsables=[ramirez],
    )
    _equipo(admin, escaner, area, nombre="Escáner de andén", marca="Honeywell", serie="S-2")

    assert _series(cliente.get(ACTIVOS, {"q": "zebra anden"})) == ["S-1"]
    assert _series(cliente.get(ACTIVOS, {"q": "jose escaner"})) == ["S-1"]
    assert _series(cliente.get(ACTIVOS, {"q": "zebra honeywell"})) == []


def test_un_equipo_con_varios_responsables_que_coinciden_sale_una_vez(
    cliente, admin, escaner, area
):
    turno = [
        _persona(area, "Ñandú", "Ramírez", "LOG-1"),
        _persona(area, "Ana", "Ramírez", "LOG-2"),
    ]
    _equipo(
        admin,
        escaner,
        area,
        nombre="Escáner compartido",
        marca="Zebra",
        serie="S-1",
        responsables=turno,
        compartido=True,
    )

    respuesta = cliente.get(ACTIVOS, {"q": "ramirez"})
    assert _series(respuesta) == ["S-1"]
    assert respuesta.data["count"] == 1
    assert _series(cliente.get(ACTIVOS, {"q": "nandu"})) == ["S-1"]


def test_la_etiqueta_escaneada_se_sigue_encontrando_entera(cliente, admin, escaner, area):
    activo = _equipo(admin, escaner, area, nombre="Escáner", marca="Zebra", serie="S-1")
    assert _series(cliente.get(ACTIVOS, {"q": activo.codigo_barras})) == ["S-1"]


def test_los_tipos_de_equipo_se_buscan_sin_tildes(cliente, escaner):
    TipoDispositivo.objects.create(nombre="Impresora", codigo="IMP")
    respuesta = cliente.get(TIPOS, {"q": "escaner"})
    assert respuesta.status_code == 200
    assert [t["nombre"] for t in respuesta.data["results"]] == ["Escáner"]
