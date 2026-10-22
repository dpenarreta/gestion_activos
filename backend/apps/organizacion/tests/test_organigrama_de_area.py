"""Cada persona ve el organigrama de su área (21/10/2026).

Con `institucional.ver_area` (lo trae todo cargo) se ve la unidad del cargo y
las que dependen de ella; con `institucional.ver`, toda la empresa. El recorte
lo hace el servidor: lo de otras áreas no sale de la base.
"""

from apps.organizacion.models import (
    Cargo,
    DatosDeContacto,
    NivelJerarquico,
    UnidadOrganizacional,
)
from apps.organizacion.tests.test_carga_personas import _cuenta

URL = "/api/v1/organizacion/organigrama/"


def _empresa():
    gerencia = NivelJerarquico.objects.create(nombre="Gerencia", orden=1)
    area = NivelJerarquico.objects.create(nombre="Área", orden=2)
    gg = UnidadOrganizacional.objects.create(nombre="Gerencia General", nivel=gerencia)
    ti = UnidadOrganizacional.objects.create(nombre="Tecnología", nivel=area, padre=gg)
    soporte = UnidadOrganizacional.objects.create(nombre="Soporte", nivel=area, padre=ti)
    comercial = UnidadOrganizacional.objects.create(nombre="Comercial", nivel=area, padre=gg)
    gerente = Cargo.objects.create(nombre="Gerente General", unidad=gg)
    jefe_ti = Cargo.objects.create(nombre="Jefe TI", unidad=ti, jefe=gerente)
    Cargo.objects.create(nombre="Técnico", unidad=soporte, jefe=jefe_ti)
    Cargo.objects.create(nombre="Vendedor", unidad=comercial, jefe=gerente)
    return {"ti": ti, "jefe_ti": jefe_ti}


def _nombres(datos, clave):
    return sorted(x["nombre"] for x in datos[clave])


def test_con_su_area_ve_su_unidad_y_las_que_dependen_de_ella(db):
    e = _empresa()
    rosa, cliente = _cuenta("rosa", "institucional.ver_area")
    DatosDeContacto.objects.create(usuario=rosa, cargo=e["jefe_ti"])

    datos = cliente.get(URL).json()
    assert datos["alcance"] == {
        "tipo": "area",
        "unidad": {"id": e["ti"].id, "nombre": "Tecnología"},
    }
    assert _nombres(datos, "unidades") == ["Soporte", "Tecnología"]
    assert _nombres(datos, "cargos") == ["Jefe TI", "Técnico"]
    # Ni Comercial ni la Gerencia General salen del servidor.
    assert "Vendedor" not in str(datos) and "Gerente General" not in _nombres(datos, "cargos")


def test_con_ver_ve_toda_la_empresa(db):
    _empresa()
    _, cliente = _cuenta("gerencia", "institucional.ver")
    datos = cliente.get(URL).json()
    assert datos["alcance"] == {"tipo": "empresa"}
    assert len(datos["unidades"]) == 4 and len(datos["cargos"]) == 4


def test_sin_cargo_no_ve_ninguna_rama(db):
    _empresa()
    _, cliente = _cuenta("nueva", "institucional.ver_area")
    datos = cliente.get(URL).json()
    assert datos["alcance"] == {"tipo": "area", "unidad": None}
    assert datos["unidades"] == [] and datos["cargos"] == []


def test_sin_ningun_permiso_no_ve_el_organigrama(db):
    _empresa()
    _, cliente = _cuenta("nadie")
    assert cliente.get(URL).status_code == 403


def test_todo_cargo_trae_ver_su_area(db):
    from apps.organizacion.roles_de_cargo import PERMISOS_BASE

    assert "institucional.ver_area" in PERMISOS_BASE
