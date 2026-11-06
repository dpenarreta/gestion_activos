"""La bitácora y el catálogo de repuestos se buscan sin tildes ni mayúsculas
(ver `apps.core.busqueda`)."""

import datetime

import pytest
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.mantenimientos.models import CatalogoComponente, Mantenimiento
from apps.mantenimientos.services import MantenimientoService
from apps.organizacion.models import Departamento
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_mant_tildes",
        email="admin_mant_tildes@example.com",
        password="Sup3r-Secr3t!",
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def activo(admin):
    return ActivoService.crear_activo(
        actor=admin,
        tipo=TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP"),
        nombre="Laptop de Facturación",
        marca="HP",
        modelo="ProBook 450",
        numero_serie="SN-TILDE-1",
        departamento=Departamento.objects.create(nombre="Operaciones", codigo="OPS"),
        fecha_adquisicion=datetime.date(2023, 1, 10),
    )


def _registrar(admin, activo, descripcion, responsable):
    return MantenimientoService.registrar(
        actor=admin,
        activo=activo,
        componentes=[],
        tipo=Mantenimiento.Tipo.CORRECTIVO,
        fecha_intervencion=datetime.date(2024, 6, 1),
        tipo_responsable=Mantenimiento.TipoResponsable.TECNICO_INTERNO,
        responsable=responsable,
        descripcion=descripcion,
        diagnostico="Revisión general",
    )


def test_caida_encuentra_la_intervencion_escrita_con_tilde(cliente, admin, activo):
    _registrar(admin, activo, "Caída del equipo desde el escritorio", "Luis Muñoz")
    _registrar(admin, activo, "Cambio de teclado", "Ana Torres")

    respuesta = cliente.get("/api/v1/mantenimientos/", {"q": "caida"})
    assert respuesta.status_code == 200
    assert [m["descripcion"] for m in respuesta.data["results"]] == [
        "Caída del equipo desde el escritorio"
    ]
    # Varias palabras en cualquier orden, entre campos distintos.
    respuesta = cliente.get("/api/v1/mantenimientos/", {"q": "MUNOZ caida"})
    assert respuesta.data["count"] == 1
    # El nombre del equipo, que es lo que se ve en la fila.
    assert cliente.get("/api/v1/mantenimientos/", {"q": "facturacion"}).data["count"] == 2


def test_el_catalogo_de_repuestos_se_busca_sin_tildes(cliente):
    CatalogoComponente.objects.create(nombre="Batería de respaldo", codigo="BAT", es_critico=True)
    CatalogoComponente.objects.create(nombre="Teclado", codigo="TEC", es_critico=False)

    respuesta = cliente.get("/api/v1/mantenimientos/componentes/", {"q": "BATERIA"})
    assert respuesta.status_code == 200
    assert [c["nombre"] for c in respuesta.data["results"]] == ["Batería de respaldo"]
