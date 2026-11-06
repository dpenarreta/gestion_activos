"""Los listados de Gestión Humana se buscan sin tildes ni mayúsculas, cada
palabra en cualquier orden (ver `apps.core.busqueda`)."""

import pytest

from apps.core.busqueda import COLACION_SIN_TILDES
from apps.novedades.models import OvertimeRecord
from apps.novedades.services import (
    CollaboratorInput,
    CollaboratorService,
    MovementPermissionService,
    MovementService,
    OvertimeService,
)

from .conftest import _user, access

pytestmark = pytest.mark.django_db
BASE = "/api/v1/novedades"


@pytest.fixture
def colaboradores(supervisor):
    def alta(cedula, nombre):
        return CollaboratorService.create(
            access(supervisor),
            CollaboratorInput(cedula=cedula, full_name=nombre, regional="Sierra", cargo="Operador"),
        )

    return {
        "nandu": alta("0102030405", "ÑANDÚ RAMÍREZ JOSÉ"),
        "ana": alta("0102030406", "Ana Cevallos"),
    }


def test_colaboradores(client_for, admin, colaboradores):
    def buscar(termino):
        respuesta = client_for(admin).get(f"{BASE}/collaborators/", {"q": termino})
        assert respuesta.status_code == 200
        return {fila["id"] for fila in respuesta.json()}

    nandu = colaboradores["nandu"].pk
    assert buscar("nandu") == {nandu}
    assert buscar("jose ramirez") == {nandu}
    assert buscar("Ñandú") == {nandu}
    assert buscar("ramirez cevallos") == set()


def test_ingresos(admin, colaboradores):
    filas = MovementService.entries(admin, {"q": "ramirez nandu"})["results"]
    assert {f["collaborator_id"] for f in filas} == {colaboradores["nandu"].pk}


def test_personas_para_los_permisos_de_ingresos_y_salidas(admin):
    persona = _user("imunoz", "ANALISTA_CC")
    persona.first_name, persona.last_name = "Íñigo", "Muñoz"
    persona.save()
    _user("acevallos", "ANALISTA_CC")

    filas = MovementPermissionService.users(admin, "inigo MUNOZ")
    assert [f["id"] for f in filas] == [persona.pk]


def test_horas_extras_por_nombre_y_area_sin_tildes():
    consulta = OvertimeService.filter(
        OvertimeRecord.objects.all(), {"name": "jose ramirez", "area": "logistica"}
    )
    sql = str(consulta.query)
    # Dos palabras del nombre y una del área: cada una con la colación.
    assert sql.count(f"COLLATE {COLACION_SIN_TILDES}") == 3
