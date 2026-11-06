"""Lo propio de la intranet en Mejora continua (lo que no existía en Nexo):

- Multiempresa: las ideas, sus votos, su historial y sus adjuntos de una
  empresa no se ven ni se tocan desde otra; `X-Empresa` decide en cuál.
- Las rutas son del módulo Gestión Humana y se apagan con él.
- El Administrador de TI no entra; el rol de otra empresa no cuenta.
- Auditoría común (`mejora_continua`).

Aquí la empresa la decide cada petición: se anula el fixture global que fija
una de antemano (como en `apps/projects/tests/test_intranet.py`).
"""

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, EstadoModulo, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.mejora_continua.models import IdeaStatusHistory, IdeaVote, ImprovementIdea
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import PDF_BYTES

BASE = "/api/v1/mejora-continua"


@pytest.fixture(autouse=True)
def _empresa_de_pruebas():
    """Anula el fixture global: aquí la empresa la decide `X-Empresa`."""
    yield


@pytest.fixture
def courier(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture
def seguridad(db):
    return Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")


def _cuenta(nombre, roles_por_empresa: dict):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.title(),
    )
    for indice, (empresa, roles) in enumerate(roles_por_empresa.items()):
        membresia = MembresiaEmpresa.objects.create(
            usuario=usuario, empresa=empresa, es_predeterminada=indice == 0
        )
        membresia.roles.set([Group.objects.get(name=rol) for rol in roles])
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=User.objects.get(pk=usuario.pk))
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.pk))
    return cliente


def _idea(empresa, autor, **extra):
    with usando_empresa(empresa):
        return ImprovementIdea.objects.create(
            title="Ruta de buses para el turno nocturno",
            description="Con paradas en Durán y Samborondón",
            impact="ALTO",
            author=autor,
            **extra,
        )


# --- Acceso al módulo ------------------------------------------------------------


def test_las_rutas_son_del_modulo_gestion_humana():
    assert modulo_de_ruta(f"{BASE}/ideas/") == "gestion_humana"
    assert modulo_de_ruta(f"{BASE}/ideas/1/attachment/") == "gestion_humana"


def test_el_administrador_de_ti_no_entra(courier):
    """Decisión del usuario (05/11/2026): el rol «Administrador» no tiene lo de
    Gestión Humana que no es de TI."""
    ti = _cuenta("admin_ti", {courier: ["Administrador"]})
    assert _cliente(ti, courier).get(f"{BASE}/ideas/").status_code == 403


@pytest.mark.parametrize(
    "rol",
    [
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
        ADMIN_GH,
    ],
)
def test_cada_rol_de_gestion_humana_entra_y_propone(courier, rol):
    persona = _cuenta("persona", {courier: [rol]})
    cliente = _cliente(persona, courier)
    assert cliente.get(f"{BASE}/ideas/").status_code == 200
    respuesta = cliente.post(
        f"{BASE}/ideas/", {"title": "Idea", "description": "D", "impact": "BAJO"}, format="json"
    )
    assert respuesta.status_code == 201
    with usando_empresa(courier):
        assert ImprovementIdea.objects.get().empresa_id == courier.pk


def test_el_rol_de_otra_empresa_no_cuenta(courier, seguridad):
    persona = _cuenta("persona", {courier: ["ANALISTA_CC"], seguridad: []})
    assert _cliente(persona, seguridad).get(f"{BASE}/ideas/").status_code == 403


def test_con_el_modulo_apagado_no_hay_api(courier):
    """El bloqueo corre en la autenticación: se prueba con un token de verdad
    (`force_authenticate` se la salta), como en `apps/empresas/tests/test_modulos.py`."""
    from apps.authentication.services import AuthenticationService

    _cuenta("persona", {courier: ["ANALISTA_CC"]})
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="persona", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.credentials(
        HTTP_AUTHORIZATION=f"Bearer {tokens['access']}", HTTP_X_EMPRESA=str(courier.pk)
    )
    assert cliente.get(f"{BASE}/ideas/").status_code == 200
    with usando_empresa(courier):
        EstadoModulo.objects.create(clave="gestion_humana", activo=False)
    respuesta = cliente.get(f"{BASE}/ideas/")
    assert respuesta.status_code == 403
    assert "modulo_apagado" in str(respuesta.json())


# --- Aislamiento por empresa ---------------------------------------------------------


def test_la_idea_de_otra_empresa_no_existe(courier, seguridad, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    admin = _cuenta("admin", {courier: [ADMIN_GH], seguridad: [ADMIN_GH]})
    subida = _cliente(admin, seguridad).post(
        f"{BASE}/ideas/",
        {
            "title": "De LaarSeguridad",
            "description": "D",
            "impact": "MEDIO",
            "attachment": SimpleUploadedFile("propuesta.pdf", PDF_BYTES),
        },
        format="multipart",
    )
    assert subida.status_code == 201
    pk = subida.json()["id"]
    _cliente(admin, seguridad).put(f"{BASE}/ideas/{pk}/vote/")

    cliente = _cliente(admin, courier)
    assert cliente.get(f"{BASE}/ideas/").json() == []
    assert cliente.get(f"{BASE}/ideas/{pk}/").status_code == 404
    assert cliente.get(f"{BASE}/ideas/{pk}/attachment/").status_code == 404
    assert cliente.get(f"{BASE}/ideas/{pk}/history/").status_code == 404
    assert cliente.post(f"{BASE}/ideas/{pk}/vote/").status_code == 404
    assert (
        cliente.post(f"{BASE}/ideas/{pk}/status/", {"action": "ADVANCE"}, format="json").status_code
        == 404
    )
    assert cliente.patch(f"{BASE}/ideas/{pk}/", {"progress": 10}, format="json").status_code == 404

    with usando_empresa(seguridad):
        idea = ImprovementIdea.objects.get(pk=pk)
        assert idea.status == "PROPUESTA" and idea.progress == 0
        assert IdeaVote.objects.count() == 1
    with usando_empresa(courier):
        assert not IdeaVote.objects.exists() and not IdeaStatusHistory.objects.exists()
    assert [i["id"] for i in _cliente(admin, seguridad).get(f"{BASE}/ideas/").json()] == [pk]


def test_la_insignia_es_de_la_empresa(courier, seguridad):
    autora = _cuenta("autora", {courier: ["ANALISTA_CC"], seguridad: ["ANALISTA_CC"]})
    _idea(seguridad, autora, status="IMPLEMENTADA")
    assert _cliente(autora, seguridad).get(f"{BASE}/me/").json()["innovador"] is True
    assert _cliente(autora, courier).get(f"{BASE}/me/").json()["innovador"] is False


def test_el_organigrama_de_otra_empresa_no_cuenta(courier, seguridad):
    jefe = _cuenta("jefe", {courier: ["COORDINADOR_ZS"], seguridad: ["COORDINADOR_ZS"]})
    analista = _cuenta("analista", {courier: ["ASISTENTE_GH"], seguridad: ["ASISTENTE_GH"]})
    with usando_empresa(seguridad):
        arriba = Cargo.objects.create(nombre="Jefatura")
        DatosDeContacto.objects.create(usuario=jefe, cargo=arriba)
        DatosDeContacto.objects.create(
            usuario=analista, cargo=Cargo.objects.create(nombre="Analista", jefe=arriba)
        )
    idea = _idea(courier, analista)
    assert _cliente(jefe, courier).get(f"{BASE}/ideas/{idea.pk}/").status_code == 404
    otra = _idea(seguridad, analista)
    assert _cliente(jefe, seguridad).get(f"{BASE}/ideas/{otra.pk}/").status_code == 200


# --- Auditoría ------------------------------------------------------------------------


def test_auditoria_del_modulo(courier):
    jefa = _cuenta("jefa", {courier: ["JEFE_NACIONAL"]})
    autora = _cuenta("autora", {courier: ["ANALISTA_CC"]})
    idea = _idea(courier, autora)
    _cliente(jefa, courier).post(
        f"{BASE}/ideas/{idea.pk}/status/",
        {"action": "REJECT", "comment": "Sin presupuesto este año"},
        format="json",
    )
    evento = AuditLog.objects.get(action="mejora_continua.etapa_cambiada")
    assert evento.module == "mejora_continua"
    assert evento.empresa_id == courier.pk
    assert evento.previous_values == {"status": "PROPUESTA"}
    assert evento.new_values["status"] == "RECHAZADA"
