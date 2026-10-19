"""El organigrama institucional (módulo Institucional).

Lo que se protege (19/10/2026): el árbol es un árbol (sin círculos, y los
niveles bajan), los cargos cuelgan de una unidad y de un jefe, no se borra lo
que tiene algo debajo, y quién ocupa un cargo es un solo dato que se elige en
«Mi perfil» o asigna un administrador.
"""

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.permissions.models import ModulePermission
from apps.users.models import User

BASE = "/api/v1/organizacion/"


def _cuenta(nombre, *permisos):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            # «ver» es `institucional.ver`; con punto, el código completo.
            codename__in=[p if "." in p else f"institucional.{p}" for p in permisos],
        )
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa_actual())
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return usuario, cliente


@pytest.fixture
def estructura(db):
    """Presidencia > Gerencia de TI > Soporte, con sus cargos."""
    _, admin = _cuenta("ines", "ver", "editar", "asignar")

    def crear(ruta, **datos):
        respuesta = admin.post(f"{BASE}{ruta}/", datos, format="json")
        assert respuesta.status_code == 201, respuesta.data
        return respuesta.json()

    presidencia = crear("niveles", nombre="Presidencia", orden=1)
    gerencia = crear("niveles", nombre="Gerencia", orden=2)
    area = crear("niveles", nombre="Área", orden=3)
    raiz = crear("unidades", nombre="Presidencia ejecutiva", nivel=presidencia["id"])
    ti = crear("unidades", nombre="Gerencia de TI", nivel=gerencia["id"], padre=raiz["id"])
    soporte = crear("unidades", nombre="Soporte", nivel=area["id"], padre=ti["id"])
    presidente = crear("cargos", nombre="Presidente", unidad=raiz["id"])
    gerente = crear("cargos", nombre="Gerente de TI", unidad=ti["id"], jefe=presidente["id"])
    analista = crear(
        "cargos", nombre="Analista de soporte", unidad=soporte["id"], jefe=gerente["id"], plazas=3
    )
    return {
        "admin": admin,
        "niveles": (presidencia, gerencia, area),
        "raiz": raiz,
        "ti": ti,
        "soporte": soporte,
        "presidente": presidente,
        "gerente": gerente,
        "analista": analista,
    }


def test_el_organigrama_trae_niveles_unidades_y_cargos_con_sus_vacantes(estructura):
    datos = estructura["admin"].get(f"{BASE}organigrama/").json()
    assert [n["nombre"] for n in datos["niveles"]] == ["Presidencia", "Gerencia", "Área"]
    unidades = {u["nombre"]: u for u in datos["unidades"]}
    assert unidades["Soporte"]["padre"] == estructura["ti"]["id"]
    analista = next(c for c in datos["cargos"] if c["nombre"] == "Analista de soporte")
    assert analista["jefe"] == estructura["gerente"]["id"]
    assert analista["plazas"] == 3 and analista["vacantes"] == 3


def test_una_unidad_no_cuelga_de_un_nivel_inferior_ni_de_si_misma(estructura):
    admin = estructura["admin"]
    presidencia, _, area = estructura["niveles"]
    # Una Gerencia debajo de un Área: los niveles bajan.
    respuesta = admin.post(
        f"{BASE}unidades/",
        {"nombre": "Otra", "nivel": presidencia["id"], "padre": estructura["soporte"]["id"]},
        format="json",
    )
    assert respuesta.status_code == 400
    assert "nivel superior" in str(respuesta.data)
    # Ni de una de sus hijas: sería un círculo.
    respuesta = admin.patch(
        f"{BASE}unidades/{estructura['ti']['id']}/",
        {"padre": estructura["soporte"]["id"], "nivel": area["id"]},
        format="json",
    )
    assert respuesta.status_code == 400


def test_un_cargo_no_reporta_a_uno_de_sus_subordinados(estructura):
    respuesta = estructura["admin"].patch(
        f"{BASE}cargos/{estructura['presidente']['id']}/",
        {"jefe": estructura["analista"]["id"]},
        format="json",
    )
    assert respuesta.status_code == 400
    assert "subordinados" in str(respuesta.data)


def test_el_nombre_de_un_cargo_se_repite_bajo_otro_jefe_no_bajo_el_mismo(estructura):
    """«Asesor Comercial» del coordinador y del jefe de ventas son dos cargos;
    dos «Asesor Comercial» del mismo jefe serían el mismo."""
    admin = estructura["admin"]
    repetido = {
        "nombre": "analista de soporte",
        "unidad": estructura["soporte"]["id"],
        "jefe": estructura["gerente"]["id"],
    }
    assert admin.post(f"{BASE}cargos/", repetido, format="json").status_code == 400
    otro_jefe = {**repetido, "jefe": estructura["presidente"]["id"]}
    assert admin.post(f"{BASE}cargos/", otro_jefe, format="json").status_code == 201
    otra_unidad = {**repetido, "unidad": estructura["ti"]["id"]}
    assert admin.post(f"{BASE}cargos/", otra_unidad, format="json").status_code == 201

    # En los selectores se distinguen por su jefe.
    rosa, cliente_rosa = _cuenta("rosa")
    nombres = [c["nombre"] for c in cliente_rosa.get(f"{BASE}mis-datos/").json()["cargos"]]
    assert "Analista de soporte · Soporte (reporta a Gerente de TI)" in nombres
    assert "analista de soporte · Soporte (reporta a Presidente)" in nombres


def test_no_se_borra_lo_que_tiene_algo_debajo(estructura):
    admin = estructura["admin"]
    assert admin.delete(f"{BASE}unidades/{estructura['ti']['id']}/").status_code == 409
    assert admin.delete(f"{BASE}cargos/{estructura['gerente']['id']}/").status_code == 409
    assert admin.delete(f"{BASE}niveles/{estructura['niveles'][0]['id']}/").status_code == 409
    # Lo que no tiene nada debajo sí.
    assert admin.delete(f"{BASE}cargos/{estructura['analista']['id']}/").status_code == 204


def test_el_cargo_lo_elige_la_persona_o_lo_asigna_el_administrador(estructura):
    rosa, cliente_rosa = _cuenta("rosa")
    analista = estructura["analista"]["id"]

    # El administrador la asigna...
    respuesta = estructura["admin"].post(
        f"{BASE}asignaciones/", {"usuario": rosa.id, "cargo": analista}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    perfil = cliente_rosa.get(f"{BASE}mis-datos/").json()
    assert perfil["cargo"]["nombre"] == "Analista de soporte · Soporte"

    datos = estructura["admin"].get(f"{BASE}organigrama/").json()
    cargo = next(c for c in datos["cargos"] if c["id"] == analista)
    assert [o["nombre"] for o in cargo["ocupantes"]] == ["Rosa"]
    assert cargo["vacantes"] == 2

    # ...y no se borra un cargo con gente.
    assert estructura["admin"].delete(f"{BASE}cargos/{analista}/").status_code == 409

    # Sacarla del cargo.
    estructura["admin"].post(
        f"{BASE}asignaciones/", {"usuario": rosa.id, "cargo": None}, format="json"
    )
    assert cliente_rosa.get(f"{BASE}mis-datos/").json()["cargo"] is None


def test_cada_accion_pide_su_permiso(estructura):
    _, solo_ve = _cuenta("vale", "ver")
    _, nadie = _cuenta("nico")
    assert nadie.get(f"{BASE}organigrama/").status_code == 403
    assert solo_ve.get(f"{BASE}organigrama/").status_code == 200
    nivel = {"nombre": "Sección", "orden": 4}
    assert solo_ve.post(f"{BASE}niveles/", nivel, format="json").status_code == 403
    assert solo_ve.get(f"{BASE}asignaciones/").status_code == 403


def test_quien_solo_asigna_lee_el_organigrama_para_su_pestana(estructura):
    """La asignación es una pestaña de Estructura y lista los cargos con sus
    vacantes: quien solo asigna lee el organigrama, pero no lo cambia."""
    _, asigna = _cuenta("ale", "asignar")
    assert asigna.get(f"{BASE}organigrama/").status_code == 200
    assert asigna.get(f"{BASE}asignaciones/").status_code == 200
    nivel = {"nombre": "Sección", "orden": 4}
    assert asigna.post(f"{BASE}niveles/", nivel, format="json").status_code == 403
