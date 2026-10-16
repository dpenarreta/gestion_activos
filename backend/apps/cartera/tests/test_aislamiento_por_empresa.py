"""Cartera en un sistema multiempresa: cada dashboard es de una empresa.

El módulo viene de un sistema de una sola empresa. Lo que se prueba aquí es lo
que la integración añade: que lo de una empresa no se vea ni se toque desde
otra, y que los roles asignados por empresa cuenten en la ACL de cada
dashboard. Son pruebas de función (no clases `TestCase`) para que ninguna
empresa venga fijada de antemano: cada petición resuelve la suya.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.cartera.models import CargaArchivo, Dashboard
from apps.cartera.services.dashboards import crear_dashboard
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _permisos(*codigos):
    return Permission.objects.filter(
        content_type=ContentType.objects.get_for_model(ModulePermission),
        codename__in=codigos,
    )


def _rol(nombre, *codigos):
    grupo = Group.objects.create(name=nombre)
    grupo.permissions.set(_permisos(*codigos))
    return grupo


def _cuenta(nombre, *codigos):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(_permisos(*codigos))
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


def _membresia(usuario, empresa, *roles):
    membresia = MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    membresia.roles.set(roles)
    return membresia


@pytest.fixture
def courier():
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad():
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


def _dashboard_de(empresa, nombre):
    with usando_empresa(empresa):
        return crear_dashboard(nombre=nombre)


def test_el_dashboard_nace_en_la_empresa_activa_y_su_layout_tambien(courier):
    dashboard = _dashboard_de(courier, "Cobranza")
    assert dashboard.empresa_id == courier.id
    from apps.cartera.models import DashboardLayout

    assert DashboardLayout.objects.todas().get(dashboard_id=dashboard.dashboard_id).empresa_id == courier.id


def test_cada_empresa_ve_solo_sus_dashboards(courier, seguridad):
    _dashboard_de(courier, "Cobranza Courier")
    _dashboard_de(seguridad, "Cobranza Seguridad")
    cuenta = _cuenta("ana", "dashboard.view")
    _membresia(cuenta, courier)
    _membresia(cuenta, seguridad)

    en_courier = [d["name"] for d in _cliente(cuenta, courier).get("/api/v1/dashboards/authorized").data]
    en_seguridad = [d["name"] for d in _cliente(cuenta, seguridad).get("/api/v1/dashboards/authorized").data]
    assert en_courier == ["Cobranza Courier"]
    assert en_seguridad == ["Cobranza Seguridad"]


def test_el_dashboard_de_otra_empresa_no_se_abre_ni_se_edita(courier, seguridad):
    ajeno = _dashboard_de(seguridad, "Directorio")
    cuenta = _cuenta("beto", "dashboard.view", "dashboard.layout.edit", "dashboard.editar")
    _membresia(cuenta, courier)
    _membresia(cuenta, seguridad)
    cliente = _cliente(cuenta, courier)

    assert cliente.get(f"/api/v1/dashboards/{ajeno.dashboard_id}/layout").status_code == 403
    respuesta = cliente.put(
        f"/api/v1/dashboards/{ajeno.dashboard_id}/layout", {"version": 1, "components": []}, format="json"
    )
    assert respuesta.status_code == 403
    assert cliente.get(f"/api/v1/dashboards/{ajeno.dashboard_id}/versions").status_code == 403
    # Desde su empresa, en cambio, sí.
    assert _cliente(cuenta, seguridad).get(f"/api/v1/dashboards/{ajeno.dashboard_id}/layout").status_code == 200


def test_el_mismo_nombre_en_dos_empresas_no_choca(courier, seguridad):
    """El identificador del dashboard es único en toda la base: el segundo
    toma otro, aunque desde su empresa no se vea el primero."""
    primero = _dashboard_de(courier, "Cartera")
    segundo = _dashboard_de(seguridad, "Cartera")
    assert primero.dashboard_id == "cartera"
    assert segundo.dashboard_id == "cartera-2"
    assert Dashboard.objects.todas().count() == 2


def test_la_carga_de_otra_empresa_no_se_consulta(courier, seguridad):
    dashboard = _dashboard_de(seguridad, "Cobranza")
    with usando_empresa(seguridad):
        carga = CargaArchivo.objects.create(
            dashboard_id=dashboard.dashboard_id, nombre_original="x.xlsx", estado=CargaArchivo.Estado.PROCESADO
        )
    assert carga.empresa_id == seguridad.id
    cuenta = _cuenta("carla", "dashboard.view")
    _membresia(cuenta, courier)
    _membresia(cuenta, seguridad)

    respuesta = _cliente(cuenta, courier).get(f"/api/v1/cartera/resumen/{carga.id}")
    assert respuesta.status_code == 404


def test_un_rol_asignado_en_la_empresa_cuenta_en_la_acl_del_dashboard(courier, seguridad):
    """En el origen la ACL miraba solo los roles globales; aquí los roles
    también se asignan por empresa, y esos valen para los dashboards de esa
    empresa."""
    dashboard = _dashboard_de(courier, "Cobranza")
    lectores = _rol("Lectores de cobranza", "dashboard.view")
    dashboard.roles_lectores.set([lectores])

    con_rol = _cuenta("dora")
    _membresia(con_rol, courier, lectores)
    sin_rol = _cuenta("eva", "dashboard.view")
    _membresia(sin_rol, courier)
    # Tener el rol en otra empresa no abre este dashboard.
    en_otra = _cuenta("fede")
    _membresia(en_otra, courier)
    _membresia(en_otra, seguridad, lectores)

    ruta = f"/api/v1/dashboards/{dashboard.dashboard_id}/layout"
    assert _cliente(con_rol, courier).get(ruta).status_code == 200
    assert _cliente(sin_rol, courier).get(ruta).status_code == 403
    assert _cliente(en_otra, courier).get(ruta).status_code == 403


def test_la_plantilla_base_es_de_todas(courier, seguridad):
    """La plantilla base de Configuración no pertenece a ninguna empresa."""
    from apps.cartera.models import DashboardLayout
    from apps.cartera.services import dashboard_layout, plantilla

    with usando_empresa(courier):
        layout = dashboard_layout.obtener_o_crear_layout(plantilla.DASHBOARD_ID_PLANTILLA_BASE)
    assert layout.empresa_id is None
    with usando_empresa(seguridad):
        assert DashboardLayout.objects.filter(dashboard_id=plantilla.DASHBOARD_ID_PLANTILLA_BASE).exists()
