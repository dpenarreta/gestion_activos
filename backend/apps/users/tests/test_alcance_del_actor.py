"""Nadie reparte lo que no tiene, ni administra a quien tiene más que él.

Auditoría de seguridad, 29/10/2026:

- Dar un rol era dar todos sus permisos sin mirar si quien lo daba los tenía:
  con `usuarios.editar` uno se ponía el rol de administrador.
- Un administrador que no es superusuario podía cambiarle el correo,
  restablecerle la contraseña o deshabilitar a un superusuario, y así quedarse
  con su cuenta.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _permisos(*codenames):
    content_type = ContentType.objects.get_for_model(ModulePermission)
    return list(Permission.objects.filter(content_type=content_type, codename__in=codenames))


def _cuenta(nombre, *codenames, superusuario=False):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        is_superuser=superusuario,
    )
    usuario.user_permissions.set(_permisos(*codenames))
    return usuario


def _cliente(usuario):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


@pytest.fixture
def rol_admin():
    rol = Group.objects.create(name="Administración total")
    rol.permissions.set(_permisos("usuarios.ver", "usuarios.editar", "roles.editar"))
    return rol


# --- Roles: nadie reparte lo que no tiene ----------------------------------


def test_con_solo_usuarios_editar_no_se_asigna_un_rol_con_mas_permisos(rol_admin):
    editor = _cuenta("editor", "usuarios.ver", "usuarios.editar")

    respuesta = _cliente(editor).post(
        f"/api/v1/admin/users/{editor.id}/roles/", {"role_ids": [rol_admin.id]}, format="json"
    )

    assert respuesta.status_code == 400
    assert "roles.editar" in str(respuesta.data)
    assert not editor.groups.exists()


def test_tampoco_se_lo_asigna_a_otro(rol_admin):
    editor = _cuenta("editor", "usuarios.ver", "usuarios.editar")
    otra = _cuenta("otra")

    respuesta = _cliente(editor).post(
        f"/api/v1/admin/users/{otra.id}/roles/", {"role_ids": [rol_admin.id]}, format="json"
    )

    assert respuesta.status_code == 400
    assert not otra.groups.exists()


def test_quien_tiene_los_permisos_del_rol_si_lo_asigna(rol_admin):
    jefa = _cuenta("jefa", "usuarios.ver", "usuarios.editar", "roles.editar")
    otra = _cuenta("otra")

    respuesta = _cliente(jefa).post(
        f"/api/v1/admin/users/{otra.id}/roles/", {"role_ids": [rol_admin.id]}, format="json"
    )

    assert respuesta.status_code == 200
    assert list(otra.groups.all()) == [rol_admin]


def test_conservar_un_rol_que_ya_tenia_no_es_repartirlo(rol_admin):
    """Si no, quien no tiene todos los permisos de un rol ajeno no podría tocar
    ningún otro rol de esa persona."""
    editor = _cuenta("editor", "usuarios.ver", "usuarios.editar")
    otra = _cuenta("otra")
    otra.groups.add(rol_admin)
    lectura = Group.objects.create(name="Lectura")
    lectura.permissions.set(_permisos("usuarios.ver"))

    respuesta = _cliente(editor).post(
        f"/api/v1/admin/users/{otra.id}/roles/",
        {"role_ids": [rol_admin.id, lectura.id]},
        format="json",
    )

    assert respuesta.status_code == 200
    assert set(otra.groups.all()) == {rol_admin, lectura}


def test_el_alta_con_un_rol_que_no_tiene_no_crea_la_cuenta(rol_admin):
    creador = _cuenta("creador", "usuarios.ver", "usuarios.crear")

    respuesta = _cliente(creador).post(
        "/api/v1/admin/users/",
        {
            "email": "nueva@example.com",
            "first_name": "Nueva",
            "last_name": "Persona",
            "role_ids": [rol_admin.id],
        },
        format="json",
    )

    assert respuesta.status_code == 400
    assert not User.objects.filter(email="nueva@example.com").exists()


def test_el_alta_con_un_rol_que_si_tiene_funciona(rol_admin):
    creador = _cuenta(
        "creador", "usuarios.ver", "usuarios.crear", "usuarios.editar", "roles.editar"
    )

    respuesta = _cliente(creador).post(
        "/api/v1/admin/users/",
        {
            "email": "nueva@example.com",
            "first_name": "Nueva",
            "last_name": "Persona",
            "role_ids": [rol_admin.id],
        },
        format="json",
    )

    assert respuesta.status_code == 201
    assert list(User.objects.get(email="nueva@example.com").groups.all()) == [rol_admin]


# --- Cuentas con más poder: solo las toca un superusuario -------------------

TODO_USUARIOS = (
    "usuarios.ver",
    "usuarios.editar",
    "usuarios.deshabilitar",
    "usuarios.restablecer_password",
)


@pytest.fixture
def administrador():
    return _cuenta("administrador", *TODO_USUARIOS)


@pytest.fixture
def raiz():
    # Un segundo superusuario activo: así la regla del último administrador
    # (AC-038) no tapa la que se prueba.
    _cuenta("respaldo", superusuario=True)
    return _cuenta("raiz", superusuario=True)


def test_un_administrador_no_cambia_el_correo_de_un_superusuario(administrador, raiz):
    respuesta = _cliente(administrador).patch(
        f"/api/v1/admin/users/{raiz.id}/", {"email": "mio@example.com"}, format="json"
    )

    assert respuesta.status_code == 403
    raiz.refresh_from_db()
    assert raiz.email == "raiz@example.com"


def test_un_administrador_no_restablece_la_contrasena_de_un_superusuario(administrador, raiz):
    respuesta = _cliente(administrador).post(
        f"/api/v1/admin/users/{raiz.id}/password-reset/",
        {"send_link": False, "force_change_on_next_login": True, "revoke_sessions": True},
        format="json",
    )

    assert respuesta.status_code == 403
    raiz.refresh_from_db()
    assert raiz.must_change_password is False


@pytest.mark.parametrize("accion", ["disable", "block", "sessions/revoke"])
def test_un_administrador_no_deshabilita_ni_saca_a_un_superusuario(administrador, raiz, accion):
    respuesta = _cliente(administrador).post(f"/api/v1/admin/users/{raiz.id}/{accion}/")

    assert respuesta.status_code == 403
    raiz.refresh_from_db()
    assert raiz.status == User.Status.ACTIVE


def test_tampoco_a_quien_tiene_permisos_que_el_no_tiene(administrador):
    duena = _cuenta("duena", *TODO_USUARIOS, "roles.editar")

    respuesta = _cliente(administrador).post(f"/api/v1/admin/users/{duena.id}/disable/")

    assert respuesta.status_code == 403
    duena.refresh_from_db()
    assert duena.status == User.Status.ACTIVE


def test_otro_superusuario_si_puede(raiz):
    otro = _cuenta("otro", superusuario=True)

    cliente = _cliente(otro)
    assert (
        cliente.patch(
            f"/api/v1/admin/users/{raiz.id}/", {"email": "nuevo@example.com"}, format="json"
        ).status_code
        == 200
    )
    assert cliente.post(f"/api/v1/admin/users/{raiz.id}/disable/").status_code == 200


def test_el_administrador_sigue_administrando_a_quien_tiene_menos(administrador):
    persona = _cuenta("persona", "usuarios.ver")

    cliente = _cliente(administrador)
    assert (
        cliente.patch(
            f"/api/v1/admin/users/{persona.id}/", {"email": "nuevo@example.com"}, format="json"
        ).status_code
        == 200
    )
    assert cliente.post(f"/api/v1/admin/users/{persona.id}/disable/").status_code == 200
