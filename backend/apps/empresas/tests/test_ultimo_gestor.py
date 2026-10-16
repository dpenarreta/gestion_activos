"""La regla del último gestor (§8.9 de la Matriz) en todos sus caminos.

Una empresa que tiene a alguien con `matriz.gestionar_miembros` no puede
quedarse sin nadie: ni al editar las empresas de una persona, ni al quitarle el
permiso a un rol o borrarlo, ni al quitarle un rol general o un permiso
directo, ni al deshabilitarla o bloquearla. El cambio se rechaza entero y no
queda nada a medias.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from rest_framework.test import APIClient

from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.servicios import gestores_de
from apps.users.models import User

pytestmark = pytest.mark.django_db

GESTIONAR = "matriz.gestionar_miembros"


def _cuenta(nombre, superusuario=False):
    if superusuario:
        return User.objects.create_superuser(nombre, f"{nombre}@example.com", "Sup3r-Secr3t!")
    return User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )


def _permiso(codename):
    return Permission.objects.get(content_type__app_label="permissions", codename=codename)


@pytest.fixture
def escena():
    """LaarCourier con una sola gestora, Gina, por un rol propio de prueba."""
    empresa = Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    rol = Group.objects.create(name="Gestor de prueba")
    rol.permissions.set([_permiso(GESTIONAR), _permiso("matriz.ver_todas")])
    gina = _cuenta("gina")
    MembresiaEmpresa.objects.create(usuario=gina, empresa=empresa).roles.set([rol])
    raiz = _cuenta("raiz", superusuario=True)
    cliente = APIClient()
    cliente.force_authenticate(user=raiz)
    assert gestores_de([empresa.id]) == {empresa.id: 1}
    return {"empresa": empresa, "rol": rol, "gina": gina, "raiz": cliente}


def _sigue_con_gestor(escena):
    return gestores_de([escena["empresa"].id]).get(escena["empresa"].id) == 1


def test_quitarle_el_permiso_al_rol_se_rechaza(escena):
    respuesta = escena["raiz"].patch(
        f"/api/v1/admin/roles/{escena['rol'].id}/",
        {"permission_codenames": ["matriz.ver_todas"]},
        format="json",
    )
    assert respuesta.status_code == 400
    assert "sin nadie que gestione" in respuesta.data["error"]["message"]
    assert _sigue_con_gestor(escena)
    # El resto del rol se puede editar con normalidad.
    otra = escena["raiz"].patch(
        f"/api/v1/admin/roles/{escena['rol'].id}/",
        {"permission_codenames": [GESTIONAR]},
        format="json",
    )
    assert otra.status_code == 200


def test_borrar_el_rol_se_rechaza(escena):
    respuesta = escena["raiz"].delete(f"/api/v1/admin/roles/{escena['rol'].id}/")
    assert respuesta.status_code == 400
    assert Group.objects.filter(pk=escena["rol"].pk).exists()


@pytest.mark.parametrize("accion", ["disable", "block"])
def test_deshabilitar_o_bloquear_a_la_unica_gestora_se_rechaza(escena, accion):
    respuesta = escena["raiz"].post(f"/api/v1/admin/users/{escena['gina'].id}/{accion}/")
    assert respuesta.status_code == 400, respuesta.data
    escena["gina"].refresh_from_db()
    assert escena["gina"].status == User.Status.ACTIVE


def test_con_otra_gestora_si_se_puede(escena):
    otra = _cuenta("olga")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=escena["empresa"]).roles.set(
        [escena["rol"]]
    )
    respuesta = escena["raiz"].post(f"/api/v1/admin/users/{escena['gina'].id}/disable/")
    assert respuesta.status_code == 200


def test_quitarle_el_rol_general_que_la_hace_gestora_se_rechaza(escena):
    """Los roles son generales: uno global también hace gestora a quien tiene
    membresía en la empresa."""
    gina = escena["gina"]
    gina.groups.set([escena["rol"]])
    MembresiaEmpresa.objects.get(usuario=gina).roles.clear()
    assert _sigue_con_gestor(escena)

    respuesta = escena["raiz"].post(
        f"/api/v1/admin/users/{gina.id}/roles/", {"role_ids": []}, format="json"
    )
    assert respuesta.status_code == 400
    assert gina.groups.filter(pk=escena["rol"].pk).exists()


def test_quitarle_el_permiso_directo_se_rechaza(escena):
    gina = escena["gina"]
    gina.user_permissions.set([_permiso(GESTIONAR)])
    MembresiaEmpresa.objects.get(usuario=gina).roles.clear()
    assert _sigue_con_gestor(escena)

    respuesta = escena["raiz"].post(
        f"/api/v1/admin/users/{gina.id}/permissions/",
        {"permission_codenames": []},
        format="json",
    )
    assert respuesta.status_code == 400
    assert gina.user_permissions.filter(codename=GESTIONAR).exists()


def test_quien_esta_deshabilitado_no_cuenta_como_gestor(escena):
    otra = _cuenta("olga")
    MembresiaEmpresa.objects.create(usuario=otra, empresa=escena["empresa"]).roles.set(
        [escena["rol"]]
    )
    otra.status = User.Status.DISABLED
    otra.save()
    assert _sigue_con_gestor(escena)


def test_una_empresa_que_nunca_tuvo_gestor_no_bloquea(escena):
    vacia = Empresa.objects.create(nombre="Sin Matriz", codigo="SM")
    persona = _cuenta("pepe")
    MembresiaEmpresa.objects.create(usuario=persona, empresa=vacia)
    respuesta = escena["raiz"].post(f"/api/v1/admin/users/{persona.id}/disable/")
    assert respuesta.status_code == 200
