"""Catálogos organizacionales y control de acceso del módulo de activos."""

import datetime

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.activos.services import ActivoService
from apps.organizacion.models import Departamento, Empleado
from apps.permissions.models import ModulePermission
from apps.users.models import User


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(
        username="admin_org", email="admin_org@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def cliente(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def departamento(db):
    return Departamento.objects.create(nombre="Finanzas", codigo="FIN")


def _usuario_con_permisos(codenames, sufijo=""):
    """Usuario no-superusuario con exactamente los permisos indicados."""
    usuario = User.objects.create_user(
        username=f"operador{sufijo}",
        email=f"operador{sufijo}@example.com",
        password="Sup3r-Secr3t!",
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    grupo = Group.objects.create(name=f"Grupo {sufijo or 'base'}")
    grupo.permissions.set(
        Permission.objects.filter(content_type=content_type, codename__in=codenames)
    )
    usuario.groups.add(grupo)
    return usuario


# --- Catálogos -------------------------------------------------------------


def test_crear_un_departamento_normaliza_el_codigo_a_mayusculas(cliente):
    respuesta = cliente.post(
        "/api/v1/organizacion/departamentos/",
        {"nombre": "Recursos Humanos", "codigo": "rrhh"},
        format="json",
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["codigo"] == "RRHH"


def test_el_listado_de_departamentos_informa_cuantos_activos_tiene_cada_uno(
    cliente, admin, departamento
):
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-1",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    respuesta = cliente.get("/api/v1/organizacion/departamentos/")

    fila = next(d for d in respuesta.json()["results"] if d["id"] == departamento.id)
    assert fila["total_activos"] == 1


def test_no_se_puede_desactivar_a_un_empleado_que_aun_custodia_equipos(
    cliente, admin, departamento
):
    """Dejaría activos a nombre de alguien inactivo: exactamente la pérdida de
    trazabilidad de custodia que RF-01 busca eliminar."""
    empleado = Empleado.objects.create(
        nombres="Carla",
        apellidos="Ríos",
        codigo_empleado="EMP-0002",
        departamento=departamento,
    )
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-2",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)

    respuesta = cliente.patch(
        f"/api/v1/organizacion/empleados/{empleado.id}/", {"activo": False}, format="json"
    )

    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "empleado_con_activos"
    empleado.refresh_from_db()
    assert empleado.activo is True


def test_se_puede_desactivar_a_un_empleado_tras_reasignar_sus_equipos(cliente, admin, departamento):
    empleado = Empleado.objects.create(
        nombres="Diego",
        apellidos="Luna",
        codigo_empleado="EMP-0003",
        departamento=departamento,
    )
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-3",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=empleado)
    ActivoService.asignar_custodio(actor=admin, activo=activo, custodio=None)

    respuesta = cliente.patch(
        f"/api/v1/organizacion/empleados/{empleado.id}/", {"activo": False}, format="json"
    )

    assert respuesta.status_code == 200


def test_no_se_puede_asignar_un_activo_a_un_empleado_inactivo(cliente, admin, departamento):
    empleado = Empleado.objects.create(
        nombres="Elena",
        apellidos="Vaca",
        codigo_empleado="EMP-0004",
        departamento=departamento,
        activo=False,
    )
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-ORG-4",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    respuesta = cliente.post(
        f"/api/v1/activos/{activo.id}/asignar/", {"custodio": empleado.id}, format="json"
    )

    assert respuesta.status_code == 400


# --- Autorización ----------------------------------------------------------


def test_sin_autenticacion_el_inventario_responde_401(db):
    respuesta = APIClient().get("/api/v1/activos/")

    assert respuesta.status_code == 401


def test_ver_el_inventario_no_alcanza_para_registrar_activos(db, departamento):
    """Alta, edición, asignación y baja son permisos separados."""
    usuario = _usuario_con_permisos(["activos.ver"], "_lectura")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")

    assert client.get("/api/v1/activos/").status_code == 200

    respuesta = client.post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Equipo",
            "marca": "Dell",
            "modelo": "X",
            "numero_serie": "SN-PERM-1",
            "departamento": departamento.id,
            "fecha_adquisicion": "2024-01-01",
        },
        format="json",
    )
    assert respuesta.status_code == 403


def test_registrar_activos_no_alcanza_para_darlos_de_baja(db, admin, departamento):
    """Dar de baja es la acción con consecuencia contable: va aparte."""
    usuario = _usuario_con_permisos(["activos.ver", "activos.crear"], "_alta")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-PERM-2",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    respuesta = client.post(
        f"/api/v1/activos/{activo.id}/cambiar-estado/",
        {"estado": "dado_de_baja", "motivo": "prueba"},
        format="json",
    )

    assert respuesta.status_code == 403


def test_imprimir_etiquetas_exige_su_propio_permiso(db, admin, departamento):
    usuario = _usuario_con_permisos(["activos.ver"], "_etiquetas")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")
    activo = ActivoService.crear_activo(
        actor=admin,
        tipo=tipo,
        nombre="Equipo",
        marca="Dell",
        modelo="X",
        numero_serie="SN-PERM-3",
        departamento=departamento,
        fecha_adquisicion=datetime.date(2024, 1, 1),
    )

    assert client.get(f"/api/v1/activos/{activo.id}/etiqueta/").status_code == 403


def test_un_acceso_denegado_queda_registrado_en_auditoria(db, departamento):
    from apps.core.models import AuditLog

    usuario = _usuario_con_permisos(["activos.ver"], "_auditado")
    client = APIClient()
    client.force_authenticate(user=usuario)
    tipo = TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP")

    client.post(
        "/api/v1/activos/",
        {
            "tipo": tipo.id,
            "nombre": "Equipo",
            "marca": "Dell",
            "modelo": "X",
            "numero_serie": "SN-PERM-4",
            "departamento": departamento.id,
            "fecha_adquisicion": "2024-01-01",
        },
        format="json",
    )

    evento = AuditLog.objects.filter(action="access_denied").latest("created_at")
    assert evento.actor == usuario
    assert evento.new_values["required_permission"] == "activos.crear"
    assert evento.result == AuditLog.Result.FAILURE
