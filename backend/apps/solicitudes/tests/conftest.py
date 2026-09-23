"""Lo que comparten las pruebas del módulo de solicitudes.

Las cuentas —quien pide, quien compra, quien administra— se montan aquí porque
las usan tanto las pruebas de comportamiento como las de seguridad, y un juego
de permisos duplicado acabaría divergiendo: la prueba de seguridad dejaría de
atacar exactamente el mismo escenario que la funcional describe.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.activos.models import TipoDispositivo
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.permissions.models import ModulePermission
from apps.users.models import User

RUTA = "/api/v1/solicitudes/"


def _permiso(codename: str) -> Permission:
    """El del catálogo, no cualquiera que se llame igual.

    Los permisos del sistema cuelgan del modelo ancla `ModulePermission`; sin
    acotar por su `ContentType`, un codename repetido en otra app daría un rol
    que no habilita nada.
    """
    return Permission.objects.get(
        content_type=ContentType.objects.get_for_model(ModulePermission),
        codename=codename,
    )


def _rol(nombre: str, *codenames: str) -> Group:
    rol = Group.objects.create(name=nombre)
    rol.permissions.set([_permiso(c) for c in codenames])
    return rol


@pytest.fixture
def empresa(db):
    """La que el `conftest` deja activa para toda la suite.

    Se usa esa y no una propia: la empresa activa la fija el fixture `autouse`
    y gana sobre la cabecera de la petición, así que unas cuentas con membresía
    en otra empresa se quedarían sin ninguno de sus permisos —que es un fallo
    de la prueba, no del código—.
    """
    return Empresa.objects.get(codigo="EMP")


def _cuenta(nombre: str, empresa, *codenames: str, correo: str | None = None) -> User:
    usuario = User.objects.create_user(
        username=nombre,
        email=correo if correo is not None else f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
        last_name="Pérez",
    )
    membresia = MembresiaEmpresa.objects.create(
        usuario=usuario, empresa=empresa, es_predeterminada=True
    )
    if codenames:
        membresia.roles.set([_rol(f"rol_{nombre}", *codenames)])
    return usuario


@pytest.fixture
def pide(empresa):
    """Quien necesita el equipo: pide y ve lo suyo, nada más."""
    return _cuenta("pide", empresa, "solicitudes.ver", "solicitudes.crear")


@pytest.fixture
def compra(empresa):
    """Quien atiende las que le asignan."""
    return _cuenta(
        "compra", empresa, "solicitudes.ver", "solicitudes.crear", "solicitudes.gestionar"
    )


@pytest.fixture
def otro_comprador(empresa):
    return _cuenta(
        "otrocomprador",
        empresa,
        "solicitudes.ver",
        "solicitudes.crear",
        "solicitudes.gestionar",
    )


@pytest.fixture
def jefe(empresa):
    """Quien ve y mueve las de todos."""
    return _cuenta(
        "jefe",
        empresa,
        "solicitudes.ver",
        "solicitudes.crear",
        "solicitudes.gestionar",
        "solicitudes.administrar",
    )


@pytest.fixture
def al_confirmar(django_capture_on_commit_callbacks):
    """Ejecuta lo que el servicio dejó programado para después del `commit`.

    En producción el correo sale al confirmarse la transacción —así un servidor
    de correo lento no retrasa el registro de la solicitud—. En las pruebas la
    transacción se deshace al terminar, de modo que sin esto no se enviaría
    ninguno y lo que se estaría midiendo es el silencio.
    """
    from contextlib import contextmanager

    @contextmanager
    def _dentro():
        with django_capture_on_commit_callbacks(execute=True):
            yield

    return _dentro


def _cliente(usuario, empresa) -> APIClient:
    api = APIClient()
    api.force_authenticate(user=usuario)
    # Los permisos cuelgan de la membresía, así que sin decir en qué empresa se
    # trabaja no hay ninguno: es la misma cabecera que manda el frontend.
    api.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return api


@pytest.fixture
def laptop(empresa):
    return TipoDispositivo.objects.create(nombre="Laptop", codigo="LAP", empresa=empresa)


def _alta(encargado, **extra):
    datos = {
        "encargado": encargado.id,
        "clase": "dispositivo",
        "detalle": "Laptop para el nuevo analista",
        "cantidad": 1,
        "justificacion": "Entra el 1 de octubre y no hay equipo libre.",
        "prioridad": "alta",
    }
    datos.update(extra)
    return datos


def _crear(pide, compra, empresa, **extra) -> int:
    """Una solicitud ya registrada, para las pruebas que empiezan después."""
    respuesta = _cliente(pide, empresa).post(RUTA, _alta(compra, **extra), format="json")
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.data["id"]
