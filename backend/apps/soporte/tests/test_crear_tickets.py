"""«Crear tickets» (`soporte.crear`, 09/11/2026).

Pedir ayuda deja de ser de toda cuenta: crear un ticket a su nombre pide el
permiso, que la migración da a todos los roles y que se puede quitar a un rol.
Lo que se protege:

- con un rol sin el permiso, crear responde 403 con un mensaje claro y no deja
  nada creado; con el permiso, crea;
- la cuenta sin ningún rol puede crear (nadie se queda sin pedir ayuda en
  silencio), pero en cuanto tiene un rol manda ese rol;
- quitar el permiso no le quita sus tickets: los sigue viendo y respondiendo;
- el alta en nombre de otra persona sigue pidiendo `soporte.registrar`.
"""

import importlib
from unittest import mock

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.permissions.authorization import user_has_permission
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
CREAR = "soporte.crear"


def _permiso(codename=CREAR):
    return Permission.objects.get(content_type__app_label="permissions", codename=codename)


def _con_rol(usuario, empresa, nombre, *codenames):
    """Le pone a la persona un rol en su membresía con esos permisos."""
    rol = Group.objects.create(name=nombre)
    rol.permissions.set([_permiso(c) for c in codenames])
    MembresiaEmpresa.objects.get(usuario=usuario, empresa=empresa).roles.add(rol)
    return rol


def _cuantos(mesa):
    with usando_empresa(mesa["empresa"]):
        return Ticket.objects.count()


def test_el_permiso_esta_en_el_catalogo_y_en_la_base(db):
    from apps.permissions.catalog import all_codenames

    assert CREAR in all_codenames()
    assert _permiso().name.startswith("Crear tickets a su nombre")


def test_con_un_rol_sin_el_permiso_no_crea_y_se_le_dice_por_que(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Analista de Cobranzas · Ñandú", "licencias.solicitar")
    cliente = _equipo(carla)

    respuesta = cliente.post(SOLICITAR, _formulario(mesa), format="json")

    assert respuesta.status_code == 403
    error = respuesta.json()["error"]
    assert error["code"] == "permission_denied"
    assert error["message"] == ("No tiene permiso para crear tickets; pídalo a su administrador.")
    assert _cuantos(mesa) == 0
    # El formulario se puede abrir, pero dice que no puede crear.
    datos = cliente.get(SOLICITAR).json()
    assert datos["puede_crear"] is False
    assert CREAR not in cliente.get(ME).json()["permissions"]


def test_sin_permiso_el_403_llega_antes_que_la_validacion(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Recepción (sin soporte)")
    respuesta = _equipo(carla).post(SOLICITAR, {}, format="json")
    assert respuesta.status_code == 403


def test_con_el_permiso_en_su_rol_crea_el_ticket(mesa):
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente de Agencia · Loja", CREAR)
    cliente = _equipo(carla)
    assert cliente.get(SOLICITAR).json()["puede_crear"] is True

    with mock.patch.object(services, "repartir", return_value=0):
        respuesta = cliente.post(SOLICITAR, _formulario(mesa), format="json")

    assert respuesta.status_code == 201, respuesta.data
    with usando_empresa(mesa["empresa"]):
        assert Ticket.objects.get(pk=respuesta.data["id"]).solicitante == carla


def test_la_cuenta_sin_ningun_rol_puede_crear(mesa):
    """Una cuenta recién creada, sin cargo ni rol, es quien más necesita
    pedir ayuda: no se queda sin poder hacerlo en silencio."""
    carla = _carla(mesa)
    cliente = _equipo(carla)
    assert CREAR in cliente.get(ME).json()["permissions"]
    assert cliente.get(SOLICITAR).json()["puede_crear"] is True
    with mock.patch.object(services, "repartir", return_value=0):
        respuesta = cliente.post(SOLICITAR, _formulario(mesa), format="json")
    assert respuesta.status_code == 201, respuesta.data


def test_el_rol_de_otra_empresa_no_cuenta_como_rol_en_esta(mesa):
    """Los roles de la membresía valen en su empresa: sin ninguno aquí, es una
    cuenta sin rol en esta empresa."""
    from apps.empresas.models import Empresa

    carla = _carla(mesa)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    MembresiaEmpresa.objects.create(usuario=carla, empresa=otra)
    _con_rol(carla, otra, "Guardia · LaarSeguridad")
    with usando_empresa(mesa["empresa"]):
        assert user_has_permission(carla, CREAR)
    carla = type(carla).objects.get(pk=carla.pk)  # sin lo memorizado
    with usando_empresa(otra):
        assert not user_has_permission(carla, CREAR)


def test_un_rol_global_sin_el_permiso_tambien_lo_quita(mesa):
    carla = _carla(mesa)
    carla.groups.add(Group.objects.create(name="Consulta global"))
    respuesta = _equipo(carla).post(SOLICITAR, _formulario(mesa), format="json")
    assert respuesta.status_code == 403


def test_sin_el_permiso_sigue_viendo_y_respondiendo_sus_tickets(mesa):
    carla = _carla(mesa)
    rol = _con_rol(carla, mesa["empresa"], "Asistente de Cobranzas", CREAR)
    with mock.patch.object(services, "repartir", return_value=0):
        creado = _equipo(carla).post(SOLICITAR, _formulario(mesa), format="json").data

    rol.permissions.remove(_permiso())
    carla = type(carla).objects.get(pk=carla.pk)
    cliente = _equipo(carla)

    assert cliente.post(SOLICITAR, _formulario(mesa), format="json").status_code == 403
    lista = cliente.get(SEGUIMIENTO)
    assert lista.status_code == 200
    assert [t["id"] for t in lista.json()] == [creado["id"]]
    ficha = cliente.get(f"{SEGUIMIENTO}{creado['id']}/")
    assert ficha.status_code == 200
    respuesta = cliente.post(
        f"{SEGUIMIENTO}{creado['id']}/",
        {"texto": "Sigue sin encender, ¿alguna novedad?"},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data


def test_el_alta_en_nombre_de_otra_persona_sigue_pidiendo_registrar(mesa):
    """`soporte.crear` es para los propios: no abre el alta interna."""
    carla = _carla(mesa)
    _con_rol(carla, mesa["empresa"], "Asistente con soporte", CREAR)
    respuesta = _equipo(carla).post(f"{TICKETS}registrar/", {}, format="json")
    assert respuesta.status_code == 403


def test_la_bandeja_dice_si_puede_crear(mesa):
    jorge = mesa["jorge"].usuario  # técnico sin rol: puede crear
    datos = _equipo(jorge).get(f"{TICKETS}bandeja/").json()
    assert datos["puede"]["crear"] is True


# --- La migración ---------------------------------------------------------------------


def test_la_migracion_concede_el_permiso_a_todos_los_roles(db):
    migracion = importlib.import_module("apps.roles.migrations.0040_permiso_crear_tickets")
    permiso = _permiso()
    roles = [
        Group.objects.create(name="Analista de Cobranzas (prueba)"),
        Group.objects.create(name="Jefe TI · Tecnología (prueba)"),
        Group.objects.create(name="Rol vacío (prueba)"),
    ]
    for rol in Group.objects.all():
        rol.permissions.remove(permiso)

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    sin_permiso = Group.objects.exclude(permissions=permiso)
    assert not sin_permiso.exists()
    for rol in roles:
        assert rol.permissions.filter(pk=permiso.pk).count() == 1

    migracion.retirar(django_apps, None)
    assert not Group.objects.filter(permissions=permiso).exists()


@pytest.mark.parametrize("nombre", ["Administrador", "Superusuario"])
def test_los_roles_iniciales_traen_el_permiso(db, nombre):
    from django.core.management import call_command

    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    assert Group.objects.get(name=nombre).permissions.filter(codename=CREAR).exists()


def test_los_roles_de_cargo_nacen_con_el_permiso():
    from apps.organizacion.roles_de_cargo import PERMISOS_BASE

    assert CREAR in PERMISOS_BASE
