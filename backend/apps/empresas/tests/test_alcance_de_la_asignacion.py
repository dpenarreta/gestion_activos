"""Asignar empresas: solo las propias y solo roles con permisos que se tienen.

Auditoría de seguridad, 29/10/2026: con `empresas.asignar` se podía dar acceso
a cualquier empresa, también a una en la que uno no trabaja, y con cualquier
rol, también uno con permisos que uno no tiene.
"""

import pytest
from django.contrib.auth.models import Group

from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.tests.test_administracion import _cliente, _cuenta
from apps.permissions.models import ModulePermission

pytestmark = pytest.mark.django_db


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad():
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


ASIGNAR = ("usuarios.ver", "empresas.ver", "empresas.asignar")


def _rol(nombre, *codenames):
    from django.contrib.auth.models import Permission
    from django.contrib.contenttypes.models import ContentType

    rol = Group.objects.create(name=nombre)
    content_type = ContentType.objects.get_for_model(ModulePermission)
    rol.permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )
    return rol


def _asignar(actor, usuario, empresas, empresa=None):
    return _cliente(actor, empresa).post(
        f"/api/v1/admin/users/{usuario.id}/empresas/", {"empresas": empresas}, format="json"
    )


# --- Empresas ----------------------------------------------------------------


def test_no_se_da_acceso_a_una_empresa_en_la_que_no_se_trabaja(courier, seguridad):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    otra = _cuenta("otra")

    respuesta = _asignar(jefa, otra, [{"empresa_id": seguridad.id}], courier)

    assert respuesta.status_code == 400
    assert "LaarSeguridad" in str(respuesta.data)
    assert not MembresiaEmpresa.objects.filter(usuario=otra).exists()


def test_tampoco_se_quita_el_acceso_a_una_ajena(courier, seguridad):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    otra = _cuenta("otra", empresa=courier)
    MembresiaEmpresa.objects.create(usuario=otra, empresa=seguridad)

    respuesta = _asignar(jefa, otra, [{"empresa_id": courier.id}], courier)

    assert respuesta.status_code == 400
    assert MembresiaEmpresa.objects.filter(usuario=otra, empresa=seguridad).exists()


def test_la_membresia_ajena_que_ya_tenia_puede_venir_tal_cual(courier, seguridad):
    """La ficha manda la lista completa: la empresa ajena viene sin cambios
    mientras se cambia lo de la propia."""
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    otra = _cuenta("otra", empresa=courier)
    MembresiaEmpresa.objects.create(usuario=otra, empresa=seguridad)
    consulta = _rol("Consulta", "usuarios.ver")

    respuesta = _asignar(
        jefa,
        otra,
        [
            {"empresa_id": courier.id, "roles": [consulta.id], "es_predeterminada": True},
            {"empresa_id": seguridad.id},
        ],
        courier,
    )

    assert respuesta.status_code == 200
    assert set(
        MembresiaEmpresa.objects.filter(usuario=otra).values_list("empresa_id", flat=True)
    ) == {courier.id, seguridad.id}


def test_quien_trabaja_en_las_dos_las_reparte(courier, seguridad):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    MembresiaEmpresa.objects.create(usuario=jefa, empresa=seguridad)
    otra = _cuenta("otra")

    respuesta = _asignar(
        jefa, otra, [{"empresa_id": courier.id}, {"empresa_id": seguridad.id}], courier
    )

    assert respuesta.status_code == 200


# --- Roles de la membresía ----------------------------------------------------


def test_no_se_da_un_rol_con_permisos_que_no_se_tienen(courier):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    otra = _cuenta("otra")
    rol = _rol("Administración", "usuarios.ver", "roles.editar")

    respuesta = _asignar(jefa, otra, [{"empresa_id": courier.id, "roles": [rol.id]}], courier)

    assert respuesta.status_code == 400
    assert "roles.editar" in str(respuesta.data)
    assert not MembresiaEmpresa.objects.filter(usuario=otra).exists()


def test_ni_a_uno_mismo(courier):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    rol = _rol("Administración", "roles.editar")

    respuesta = _asignar(jefa, jefa, [{"empresa_id": courier.id, "roles": [rol.id]}], courier)

    assert respuesta.status_code == 400
    assert not MembresiaEmpresa.objects.get(usuario=jefa).roles.exists()


def test_un_rol_con_permisos_que_si_tiene_se_da(courier):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    otra = _cuenta("otra")
    rol = _rol("Consulta", "usuarios.ver", "empresas.ver")

    respuesta = _asignar(jefa, otra, [{"empresa_id": courier.id, "roles": [rol.id]}], courier)

    assert respuesta.status_code == 200
    assert list(MembresiaEmpresa.objects.get(usuario=otra).roles.all()) == [rol]


def test_conservar_el_rol_que_ya_tenia_no_es_repartirlo(courier):
    jefa = _cuenta("jefa", *ASIGNAR, empresa=courier)
    otra = _cuenta("otra")
    rol = _rol("Administración", "roles.editar")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=courier).roles.set([rol])

    respuesta = _asignar(
        jefa,
        otra,
        [{"empresa_id": courier.id, "roles": [rol.id], "es_predeterminada": True}],
        courier,
    )

    assert respuesta.status_code == 200
