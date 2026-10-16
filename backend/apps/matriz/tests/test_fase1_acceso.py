"""Matriz de obligaciones, fase 1: base y acceso.

Cobertura de tests/qa/features/matriz-obligaciones.feature (AC-MTZ-001 a
AC-MTZ-010).

La fase sale cuando «un usuario solo ve sus empresas, con su rol» (§21). Lo que
se prueba es la regla que distingue a este módulo del resto del sistema: sus
permisos valen **solo por la membresía** en cada empresa (§8.1).
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.matriz.models import Area, EntidadControl
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

MIAS = "/api/v1/matriz/empresas/mias/"
AREAS = "/api/v1/matriz/catalogos/areas/"
ENTIDADES = "/api/v1/matriz/catalogos/entidades-control/"


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


def _cliente(usuario, empresa=None):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    if empresa is not None:
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


# --- Permisos solo por membresía (§8.1) --------------------------------------


def test_un_rol_global_da_permisos_de_la_matriz_como_los_demas(courier, seguridad):
    """Los roles son generales del sistema: un rol global con `matriz.validar`
    vale en todas las empresas de la persona, igual que `activos.ver`. (Hasta
    el 15 de octubre de 2026 los de la Matriz solo valían por la membresía.)"""
    cuenta = _cuenta("global", "matriz.validar", "activos.ver")
    _membresia(cuenta, courier)

    cliente = _cliente(cuenta, courier)
    permisos = cliente.get("/api/v1/auth/me/").data["permissions"]
    assert "matriz.validar" in permisos
    assert "activos.ver" in permisos
    # Y el selector de la Matriz la ofrece, con esa capacidad.
    empresas = cliente.get("/api/v1/matriz/empresas/mias/").data["empresas"]
    assert [e["codigo"] for e in empresas] == ["LC"]
    assert "matriz.validar" in empresas[0]["capacidades"]


def test_el_rol_de_la_membresia_vale_solo_en_su_empresa(courier, seguridad):
    cuenta = _cuenta("ana")
    supervisor = Group.objects.get(name="Supervisor de cumplimiento")
    _membresia(cuenta, courier, supervisor)
    _membresia(cuenta, seguridad)

    en_courier = _cliente(cuenta, courier).get("/api/v1/auth/me/").data["permissions"]
    en_seguridad = _cliente(cuenta, seguridad).get("/api/v1/auth/me/").data["permissions"]

    assert "matriz.validar" in en_courier
    assert not [p for p in en_seguridad if p.startswith("matriz.")]


def test_el_superusuario_tiene_toda_la_matriz():
    raiz = User.objects.create_superuser(
        username="raiz", email="raiz@example.com", password="Sup3r-Secr3t!"
    )
    Empresa.objects.create(nombre="Única", codigo="UN")

    permisos = _cliente(raiz).get("/api/v1/auth/me/").data["permissions"]

    assert {"matriz.validar", "matriz.gestionar_miembros"} <= set(permisos)


# --- Las empresas de la Matriz (§14.1) ---------------------------------------


def test_solo_ve_sus_empresas_con_su_rol(courier, seguridad):
    """El criterio de salida de la fase 1."""
    cuenta = _cuenta("bea")
    responsable = Group.objects.get(name="Responsable de cumplimiento")
    inventario = _rol("Bodega", "activos.ver")
    _membresia(cuenta, courier, responsable, inventario)
    # Membresía sin rol de la Matriz: entra al inventario, no a este módulo.
    _membresia(cuenta, seguridad, inventario)

    empresas = _cliente(cuenta).get(MIAS).data["empresas"]

    assert [e["codigo"] for e in empresas] == ["LC"]
    assert empresas[0]["roles"] == ["Responsable de cumplimiento"]
    assert "matriz.cargar" in empresas[0]["capacidades"]
    assert "matriz.validar" not in empresas[0]["capacidades"]


def test_una_empresa_inactiva_no_da_acceso(courier):
    cuenta = _cuenta("cid")
    _membresia(cuenta, courier, Group.objects.get(name="Administrador"))
    courier.activa = False
    courier.save()

    assert _cliente(cuenta).get(MIAS).data["empresas"] == []


def test_los_roles_sembrados_son_los_de_la_especificacion():
    def acciones(nombre):
        return {
            p.codename.removeprefix("matriz.")
            for p in Group.objects.get(name=nombre).permissions.filter(
                codename__startswith="matriz."
            )
        }

    assert len(acciones("Administrador")) == 12
    assert acciones("Responsable de cumplimiento") == {
        "crear",
        "editar",
        "cargar",
        "enviar",
        "recordar",
    }
    assert acciones("Consulta / Auditoría") == {"ver_todas", "exportar", "ver_auditoria"}
    assert "validar" in acciones("Supervisor de cumplimiento")
    assert "crear" not in acciones("Supervisor de cumplimiento")


# --- Catálogos compartidos (§4.3, §5) ----------------------------------------


def test_los_catalogos_vienen_sembrados():
    assert Area.objects.filter(codigo="CONT").exists()
    assert EntidadControl.objects.filter(codigo="SRI").exists()
    assert Area.objects.count() == 8
    assert EntidadControl.objects.count() == 8


def test_ver_los_catalogos_exige_su_permiso():
    assert _cliente(_cuenta("sin")).get(AREAS).status_code == 403
    respuesta = _cliente(_cuenta("lector", "catalogos.ver")).get(AREAS)
    assert respuesta.status_code == 200
    assert "CONT" in [a["codigo"] for a in respuesta.data]


def test_editarlos_exige_el_suyo_y_queda_auditado():
    lector = _cliente(_cuenta("lector2", "catalogos.ver"))
    editor = _cliente(_cuenta("editor", "catalogos.ver", "catalogos.editar"))

    assert lector.post(ENTIDADES, {"codigo": "x", "nombre": "X"}).status_code == 403
    creada = editor.post(ENTIDADES, {"codigo": " supercias ", "nombre": "Supercías"})

    assert creada.status_code == 201, creada.data
    assert creada.data["codigo"] == "SUPERCIAS"
    assert AuditLog.objects.filter(action="matriz.entidad_control.created").exists()
    borrada = editor.delete(f"{ENTIDADES}{creada.data['id']}/")
    assert borrada.status_code == 204
    assert AuditLog.objects.filter(action="matriz.entidad_control.deleted").exists()


# --- La empresa gana lo que la Matriz necesita (§4.1) ------------------------


def test_la_empresa_tiene_zona_color_y_base_de_cumplimiento(courier):
    admin = _cliente(_cuenta("adm", "empresas.ver", "empresas.editar"))
    url = f"/api/v1/empresas/{courier.id}/"

    datos = admin.get(url).data
    assert datos["zona_horaria"] == "America/Guayaquil"
    assert datos["base_cumplimiento"] == "validacion"

    assert admin.patch(url, {"zona_horaria": "Marte/Olympus"}).status_code == 400
    assert admin.patch(url, {"color": "azul"}).status_code == 400
    cambio = admin.patch(url, {"color": "#0e7c86", "base_cumplimiento": "envio"})
    assert cambio.status_code == 200, cambio.data
    assert cambio.data["color"] == "#0E7C86"


def test_el_gerente_general_debe_trabajar_en_la_empresa(courier):
    admin = _cliente(_cuenta("adm2", "empresas.ver", "empresas.editar"))
    ajeno = _cuenta("ajeno")
    propio = _cuenta("propio")
    _membresia(propio, courier)
    url = f"/api/v1/empresas/{courier.id}/"

    assert admin.patch(url, {"gerente_general": ajeno.id}).status_code == 400
    respuesta = admin.patch(url, {"gerente_general": propio.id})
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.data["gerente_general_nombre"] == "propio"


def test_las_personas_de_la_empresa_para_elegir_gerente(courier, seguridad):
    admin = _cliente(_cuenta("adm3", "empresas.ver"))
    propio = _cuenta("dentro")
    _membresia(propio, courier)
    _membresia(_cuenta("fuera"), seguridad)

    personas = admin.get(f"/api/v1/empresas/{courier.id}/personas/").data

    assert [p["nombre"] for p in personas] == ["dentro"]


def test_el_selector_de_empresa_dice_el_rol_en_cada_una(courier, seguridad):
    cuenta = _cuenta("dora")
    _membresia(cuenta, courier, Group.objects.get(name="Consulta / Auditoría"))
    _membresia(cuenta, seguridad)

    empresas = {
        e["codigo"]: e for e in _cliente(cuenta).get("/api/v1/empresas/mias/").data["empresas"]
    }

    assert empresas["LC"]["roles"] == ["Consulta / Auditoría"]
    assert empresas["LS"]["roles"] == []
    assert empresas["LC"]["color"] == "#164B86"
