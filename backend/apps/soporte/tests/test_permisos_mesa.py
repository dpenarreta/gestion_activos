"""La Mesa de ayuda por dentro, para quien no es del equipo (09/11/2026).

El usuario separa en permisos distintos lo que antes iba junto:

- `soporte.mesa_mis_tickets`: entrar a la bandeja de la Mesa **solo** en «Mis
  solicitudes» (los tickets que la persona creó). Sin él, 403.
- `soporte.mesa_crear`: «Pedir ayuda (a mi nombre)» desde la bandeja. Sin él,
  403, aunque tenga `soporte.crear`.
- `soporte.crear` queda solo para «Soporte TI».

Ninguno de los dos hace a nadie parte del equipo: los tickets ajenos y las
vistas del equipo siguen pidiendo sus permisos, también por la API. Todos los
roles los traen al empezar (la migración) y la cuenta sin rol también.
"""

import importlib
from unittest import mock

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.soporte import services
from apps.soporte.models import Ticket
from apps.soporte.tests.test_soporte import (
    SEGUIMIENTO,
    SOLICITAR,
    TICKETS,
    _carla,
    _equipo,
    _formulario,
)

ME = "/api/v1/auth/me/"
MIS_SOLICITUDES = "/api/v1/soporte/mesa/mis-solicitudes/"
SOLICITAR_EN_LA_MESA = "/api/v1/soporte/mesa/solicitar/"
VER = "soporte.mesa_mis_tickets"
CREAR_EN_LA_MESA = "soporte.mesa_crear"
CREAR = "soporte.crear"


def _permiso(codename):
    return Permission.objects.get(content_type__app_label="permissions", codename=codename)


def _con_rol(usuario, empresa, nombre, *codenames):
    rol = Group.objects.create(name=nombre)
    rol.permissions.set([_permiso(c) for c in codenames])
    MembresiaEmpresa.objects.get(usuario=usuario, empresa=empresa).roles.add(rol)
    return rol


def _ticket_de(cliente, mesa, url=SOLICITAR):
    with mock.patch.object(services, "repartir", return_value=0):
        respuesta = cliente.post(url, _formulario(mesa), format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.data["id"]


def _ajeno(mesa):
    """Un ticket de otra persona: lo crea Carla todavía sin rol (puede) y pasa
    a ser del técnico Jorge. Se llama antes de darle un rol a Carla."""
    carla = _carla(mesa)
    creado = _ticket_de(_equipo(carla), mesa)
    jorge = mesa["jorge"].usuario
    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=creado).update(solicitante=jorge, solicitante_correo=jorge.email)
    return creado


def test_los_permisos_estan_en_el_catalogo(db):
    from apps.permissions.catalog import all_codenames

    assert {VER, CREAR_EN_LA_MESA} <= set(all_codenames())
    assert _permiso(VER).name.startswith("Ver sus tickets en la Mesa de ayuda")
    assert _permiso(CREAR_EN_LA_MESA).name.startswith("Crear tickets en la Mesa de ayuda")


# --- Ver sus tickets en la Mesa -----------------------------------------------------------


def test_con_solo_ver_sus_tickets_ve_solo_los_suyos(mesa):
    ajeno = _ajeno(mesa)
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente · Ver en la mesa", VER, CREAR)
    cliente = _equipo(carla)
    propio = _ticket_de(cliente, mesa)

    respuesta = cliente.get(MIS_SOLICITUDES)

    assert respuesta.status_code == 200
    assert [t["id"] for t in respuesta.json()] == [propio]
    assert ajeno not in [t["id"] for t in respuesta.json()]


def test_ver_sus_tickets_no_abre_las_vistas_del_equipo(mesa):
    """Ni la bandeja del equipo, ni la cola, ni todos, ni la ficha de un
    ticket ajeno (ni del propio por la ruta del equipo): por la API, 403."""
    ajeno = _ajeno(mesa)
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente · Solo la mesa", VER, CREAR_EN_LA_MESA)
    cliente = _equipo(carla)

    for url in (
        TICKETS,
        f"{TICKETS}?ambito=cola",
        f"{TICKETS}?ambito=todos",
        f"{TICKETS}todos/",
        f"{TICKETS}bandeja/",
        f"{TICKETS}{ajeno}/",
        f"{TICKETS}formulario/",
    ):
        assert cliente.get(url).status_code == 403, url
    assert cliente.post(f"{TICKETS}tomar_siguiente/").status_code == 403
    assert cliente.post(f"{TICKETS}registrar/", {}, format="json").status_code == 403


def test_sin_ver_sus_tickets_la_bandeja_responde_403(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente · Sin la mesa", CREAR, CREAR_EN_LA_MESA)
    cliente = _equipo(carla)
    _ticket_de(cliente, mesa)

    respuesta = cliente.get(MIS_SOLICITUDES)

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"
    # Sus tickets los sigue viendo en «Soporte TI › Mis tickets», sin permiso.
    assert len(cliente.get(SEGUIMIENTO).json()) == 1


# --- Crear en la Mesa ---------------------------------------------------------------------


def test_crear_en_la_mesa_crea_un_ticket_a_su_nombre(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente · Crea en la mesa", CREAR_EN_LA_MESA)
    cliente = _equipo(carla)
    assert cliente.get(SOLICITAR_EN_LA_MESA).json()["puede_crear"] is True

    creado = _ticket_de(cliente, mesa, SOLICITAR_EN_LA_MESA)

    with usando_empresa(mesa["empresa"]):
        assert Ticket.objects.get(pk=creado).solicitante == carla
    # Sin `soporte.crear`, desde «Soporte TI» no.
    assert cliente.post(SOLICITAR, _formulario(mesa), format="json").status_code == 403


def test_sin_crear_en_la_mesa_responde_403_aunque_tenga_crear(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente · Solo Soporte TI", CREAR, VER)
    cliente = _equipo(carla)
    assert cliente.get(SOLICITAR_EN_LA_MESA).json()["puede_crear"] is False

    respuesta = cliente.post(SOLICITAR_EN_LA_MESA, _formulario(mesa), format="json")

    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["message"] == (
        "No tiene permiso para crear tickets en la Mesa de ayuda; pídalo a su administrador."
    )
    with usando_empresa(mesa["empresa"]):
        assert not Ticket.objects.filter(solicitante=carla).exists()


def test_crear_sin_los_de_la_mesa_sigue_creando_desde_soporte_ti(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente · Solo crear", CREAR)
    cliente = _equipo(carla)

    _ticket_de(cliente, mesa, SOLICITAR)

    assert cliente.post(SOLICITAR_EN_LA_MESA, _formulario(mesa), format="json").status_code == 403
    assert cliente.get(MIS_SOLICITUDES).status_code == 403


def test_la_bandeja_del_equipo_dice_lo_de_la_mesa(mesa):
    jorge = mesa["jorge"].usuario  # técnico sin rol: los tiene por no tener rol
    puede = _equipo(jorge).get(f"{TICKETS}bandeja/").json()["puede"]
    assert puede["mesa_crear"] is True
    assert puede["mesa_mis_tickets"] is True


# --- Cuentas sin rol, roles de cargo y la migración ------------------------------------------


def test_la_cuenta_sin_ningun_rol_los_tiene(mesa):
    carla = _carla(mesa)
    cliente = _equipo(carla)
    permisos = cliente.get(ME).json()["permissions"]
    assert {VER, CREAR_EN_LA_MESA, CREAR} <= set(permisos)
    _ticket_de(cliente, mesa, SOLICITAR_EN_LA_MESA)
    assert cliente.get(MIS_SOLICITUDES).status_code == 200


def test_los_roles_de_cargo_nacen_con_ellos():
    from apps.organizacion.roles_de_cargo import PERMISOS_BASE

    assert {VER, CREAR_EN_LA_MESA, CREAR} <= set(PERMISOS_BASE)


def test_la_migracion_los_concede_a_todos_los_roles(db):
    migracion = importlib.import_module("apps.roles.migrations.0043_permisos_mesa_de_ayuda")
    permisos = [_permiso(VER), _permiso(CREAR_EN_LA_MESA)]
    roles = [
        Group.objects.create(name="Analista de Cobranzas (prueba)"),
        Group.objects.create(name="Rol vacío (prueba)"),
    ]
    for rol in Group.objects.all():
        rol.permissions.remove(*permisos)

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    for permiso in permisos:
        assert not Group.objects.exclude(permissions=permiso).exists()
        for rol in roles:
            assert rol.permissions.filter(pk=permiso.pk).count() == 1

    migracion.retirar(django_apps, None)
    for permiso in permisos:
        assert not Group.objects.filter(permissions=permiso).exists()


@pytest.mark.parametrize("nombre", ["Administrador", "Superusuario"])
def test_los_roles_iniciales_los_traen(db, nombre):
    from django.core.management import call_command

    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    rol = Group.objects.get(name=nombre)
    for codename in (VER, CREAR_EN_LA_MESA):
        assert rol.permissions.filter(codename=codename).exists()
