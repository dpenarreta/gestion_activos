"""El sistema con una sola empresa (23/10/2026; ver `apps.empresas.una_sola`).

Lo que se protege:

- Con `MULTIEMPRESA = False` no se crea una segunda empresa (la primera la
  crean las migraciones).
- Toda cuenta nueva entra a la única empresa, como predeterminada: así recibe
  el rol de su cargo; y si quien la crea ya la puso en la empresa, no se
  duplica.
- La pantalla sabe que no hay que mostrar ni elegir empresa.
"""

import pytest

from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.empresas.tests.test_administracion import _cliente, _cuenta
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _una_sola(settings):
    settings.MULTIEMPRESA = False


@pytest.fixture
def courier():
    """La empresa que crean las migraciones: el sistema arranca con una."""
    return Empresa.objects.get()


def test_no_se_crea_una_segunda_empresa(courier):
    admin = _cuenta("admin", "empresas.ver", "empresas.editar", empresa=courier)
    respuesta = _cliente(admin, courier).post(
        "/api/v1/empresas/", {"nombre": "LaarSeguridad", "codigo": "LS"}, format="json"
    )
    assert respuesta.status_code == 400
    assert "una sola empresa" in str(respuesta.json())
    assert Empresa.objects.count() == 1


def test_la_cuenta_nueva_entra_a_la_unica_empresa(courier, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        usuario = User.objects.create_user(
            username="nueva", email="nueva@grupolaar.com", password="Sup3r-Secr3t!"
        )
    membresia = MembresiaEmpresa.objects.get(usuario=usuario)
    assert membresia.empresa == courier and membresia.es_predeterminada


def test_no_duplica_si_quien_la_crea_ya_la_puso(courier, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        usuario = User.objects.create_user(
            username="nueva", email="nueva@grupolaar.com", password="Sup3r-Secr3t!"
        )
        MembresiaEmpresa.objects.create(usuario=usuario, empresa=courier, es_predeterminada=True)
    assert MembresiaEmpresa.objects.filter(usuario=usuario).count() == 1


def test_con_varias_empresas_no_se_une_sola(courier, settings, django_capture_on_commit_callbacks):
    settings.MULTIEMPRESA = True
    with django_capture_on_commit_callbacks(execute=True):
        usuario = User.objects.create_user(
            username="nueva", email="nueva@grupolaar.com", password="Sup3r-Secr3t!"
        )
    assert not MembresiaEmpresa.objects.filter(usuario=usuario).exists()


def test_la_pantalla_sabe_que_es_una_sola(courier):
    usuario = _cuenta("ana", empresa=courier)
    datos = _cliente(usuario, courier).get("/api/v1/empresas/mias/").json()
    assert datos["multiempresa"] is False
    assert [e["id"] for e in datos["empresas"]] == [courier.id]
