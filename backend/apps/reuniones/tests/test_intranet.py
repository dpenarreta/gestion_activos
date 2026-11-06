"""Lo propio de la intranet en Reuniones (lo que no existía en Nexo):

- Multiempresa: las reuniones y sus invitados de una empresa no se ven ni se
  tocan desde otra; `X-Empresa` decide en cuál. Tampoco se invita a alguien de
  otra empresa.
- Las rutas son del módulo Gestión Humana y se apagan con él.
- El catálogo, el reparto por rol y el Administrador de TI sin acceso.

Aquí la empresa la decide cada petición: se anula el fixture global que fija
una de antemano (como en `apps/mejora_continua/tests/test_intranet.py`).
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, EstadoModulo, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.permissions.catalog import PERMISSION_CATALOG
from apps.reuniones.models import Meeting, MeetingInvitee
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

BASE = "/api/v1/reuniones"
CODENAMES = {"reuniones.acceder", "reuniones.crear", "reuniones.administrar"}


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


def _datos(**extra):
    return {
        "title": "Comité de seguridad y salud",
        "meeting_date": (timezone.now() + timedelta(days=2)).isoformat(),
        "duration": 30,
        "join_url": "https://meet.google.com/abc-defg-hij",
        **extra,
    }


def _del_rol(nombre: str) -> set[str]:
    rol = Group.objects.filter(name=nombre).first()
    if rol is None:
        return set()
    return set(
        rol.permissions.filter(codename__startswith="reuniones.").values_list("codename", flat=True)
    )


# --- Catálogo y roles -------------------------------------------------------------------


def test_el_bloque_esta_en_el_catalogo_y_en_gestion_humana(db):
    bloque = PERMISSION_CATALOG["reuniones"]
    assert set(bloque["permissions"]) == CODENAMES
    assert bloque["grupo"]["id"] == "gestion_humana"
    assert (
        set(
            Permission.objects.filter(codename__startswith="reuniones.").values_list(
                "codename", flat=True
            )
        )
        == CODENAMES
    )


def test_reparto_por_rol(db):
    assert _del_rol(ADMIN_GH) == CODENAMES
    for rol in ("JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"):
        assert _del_rol(rol) == {"reuniones.acceder", "reuniones.crear"}, rol
    for rol in (
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
    ):
        assert _del_rol(rol) == {"reuniones.acceder"}, rol


def test_el_administrador_de_ti_no_los_tiene(db):
    assert _del_rol("Administrador") == set()
    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    assert _del_rol("Administrador") == set()
    assert _del_rol("Superusuario") == CODENAMES


def test_el_administrador_de_ti_no_entra(courier):
    ti = _cuenta("admin_ti", {courier: ["Administrador"]})
    assert _cliente(ti, courier).get(f"{BASE}/meetings/").status_code == 403


# --- Acceso al módulo ------------------------------------------------------------------


def test_las_rutas_son_del_modulo_gestion_humana():
    assert modulo_de_ruta(f"{BASE}/meetings/") == "gestion_humana"
    assert modulo_de_ruta(f"{BASE}/meetings/1/attendance/") == "gestion_humana"


def test_el_rol_de_otra_empresa_no_cuenta(courier, seguridad):
    persona = _cuenta("persona", {courier: ["JEFE_NACIONAL"], seguridad: []})
    assert _cliente(persona, seguridad).get(f"{BASE}/meetings/").status_code == 403


def test_con_el_modulo_apagado_no_hay_api(courier):
    """El bloqueo corre en la autenticación: se prueba con un token de verdad
    (`force_authenticate` se la salta)."""
    from apps.authentication.services import AuthenticationService

    _cuenta("persona", {courier: ["ANALISTA_CC"]})
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="persona", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.credentials(
        HTTP_AUTHORIZATION=f"Bearer {tokens['access']}", HTTP_X_EMPRESA=str(courier.pk)
    )
    assert cliente.get(f"{BASE}/meetings/").status_code == 200
    with usando_empresa(courier):
        EstadoModulo.objects.create(clave="gestion_humana", activo=False)
    respuesta = cliente.get(f"{BASE}/meetings/")
    assert respuesta.status_code == 403
    assert "modulo_apagado" in str(respuesta.json())


# --- Aislamiento por empresa ---------------------------------------------------------


def test_la_reunion_de_otra_empresa_no_existe(courier, seguridad):
    admin = _cuenta("admin", {courier: [ADMIN_GH], seguridad: [ADMIN_GH]})
    invitada = _cuenta("invitada", {courier: ["ANALISTA_CC"], seguridad: ["ANALISTA_CC"]})
    creada = _cliente(admin, seguridad).post(
        f"{BASE}/meetings/", _datos(invitee_ids=[invitada.pk]), format="json"
    )
    assert creada.status_code == 201
    pk = creada.json()["id"]

    cliente = _cliente(admin, courier)
    assert cliente.get(f"{BASE}/meetings/?scope=all").json() == []
    assert cliente.get(f"{BASE}/meetings/{pk}/").status_code == 404
    assert (
        cliente.patch(f"{BASE}/meetings/{pk}/", {"duration": 5}, format="json").status_code == 404
    )
    assert cliente.delete(f"{BASE}/meetings/{pk}/").status_code == 404
    asistencia = {"attendance": [{"user_id": invitada.pk, "attended": True}]}
    assert (
        cliente.post(f"{BASE}/meetings/{pk}/attendance/", asistencia, format="json").status_code
        == 404
    )
    assert _cliente(invitada, courier).get(f"{BASE}/meetings/").json() == []

    with usando_empresa(seguridad):
        meeting = Meeting.objects.get(pk=pk)
        assert meeting.duration == 30 and meeting.deleted_at is None
        assert MeetingInvitee.objects.get().attended is False
    with usando_empresa(courier):
        assert not Meeting.objects.exists() and not MeetingInvitee.objects.exists()


def test_no_se_invita_a_alguien_de_otra_empresa(courier, seguridad):
    jefa = _cuenta("jefa", {courier: ["JEFE_NACIONAL"]})
    de_otra = _cuenta("otra", {seguridad: ["ANALISTA_CC"]})
    respuesta = _cliente(jefa, courier).post(
        f"{BASE}/meetings/", _datos(invitee_ids=[de_otra.pk]), format="json"
    )
    assert respuesta.status_code == 400
    ids = {p["id"] for p in _cliente(jefa, courier).get(f"{BASE}/invitables/").json()}
    assert de_otra.pk not in ids
