"""Los permisos del módulo Institucional por cargo (22/10/2026).

El rol de cada cargo recibe los permisos que su cargo lleva según la tabla
(`permisos_por_cargo`), comparando el nombre sin mayúsculas ni tildes; si el
cargo se renombra, los recalcula.
"""

from apps.organizacion.models import Cargo
from apps.organizacion.permisos_por_cargo import normalizar, permisos_del_cargo
from apps.organizacion.tests.test_organigrama import BASE, _cuenta


def _codenames(cargo_id):
    rol = Cargo.objects.get(pk=cargo_id).rol
    return set(rol.permissions.values_list("codename", flat=True))


def _crear(admin, ruta, **datos):
    respuesta = admin.post(f"{BASE}{ruta}/", datos, format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def test_se_compara_sin_mayusculas_ni_tildes():
    assert normalizar("  Asistente de NÓMINA ") == "asistente de nomina"
    assert "roles_pago.habilitar" in permisos_del_cargo("asistente de nomina")
    assert permisos_del_cargo("Analista Programador") == set()


def test_el_cargo_da_sus_permisos_y_los_cambia_al_renombrarse(db):
    _, admin = _cuenta("ines", "ver", "editar", "asignar")
    nivel = _crear(admin, "niveles", nombre="Área", orden=1)
    gh = _crear(admin, "unidades", nombre="Gestión Humana", nivel=nivel["id"])
    cargo = _crear(admin, "cargos", nombre="Analista de Clima y Cultura", unidad=gh["id"])

    permisos = _codenames(cargo["id"])
    assert {"noticias.gestionar", "codigos.publicar", "institucional.editar"} <= permisos
    assert "roles_pago.consultar" not in permisos  # va persona por persona

    admin.patch(f"{BASE}cargos/{cargo['id']}/", {"nombre": "Asistente de Nómina"}, format="json")
    permisos = _codenames(cargo["id"])
    assert "noticias.gestionar" not in permisos
    assert {"roles_pago.habilitar", "roles_pago.observaciones"} <= permisos
