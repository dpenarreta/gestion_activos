"""Lo propio de la intranet en el Escritorio (lo que no existía en Nexo):

- Multiempresa: las notas, sus respuestas, los recordatorios, la bitácora y
  los adjuntos de una empresa no se ven ni se tocan desde otra; `X-Empresa`
  decide en cuál. Tampoco se deja una nota a alguien de otra empresa.
- Las rutas son del módulo Gestión Humana y se apagan con él.
- El catálogo, el reparto por rol y el Administrador de TI sin acceso.

Aquí la empresa la decide cada petición: se anula el fixture global que fija
una de antemano.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, EstadoModulo, MembresiaEmpresa
from apps.empresas.modulos import modulo_de_ruta
from apps.escritorio.models import DeskAuditLog, DeskNote, DeskNoteReply, PersonalReminder
from apps.permissions.catalog import PERMISSION_CATALOG
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import PDF_BYTES

BASE = "/api/v1/escritorio"
ROLES_DEL_DEPARTAMENTO = (
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
)


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


def _del_rol(nombre: str) -> set[str]:
    rol = Group.objects.filter(name=nombre).first()
    if rol is None:
        return set()
    return set(
        rol.permissions.filter(codename__startswith="escritorio.").values_list(
            "codename", flat=True
        )
    )


# --- Catálogo y roles -------------------------------------------------------------------


def test_el_bloque_esta_en_el_catalogo_y_en_gestion_humana(db):
    bloque = PERMISSION_CATALOG["escritorio"]
    assert set(bloque["permissions"]) == {"escritorio.acceder"}
    assert bloque["grupo"]["id"] == "gestion_humana"
    assert Permission.objects.filter(codename="escritorio.acceder").exists()


def test_reparto_por_rol(db):
    for rol in (*ROLES_DEL_DEPARTAMENTO, ADMIN_GH):
        assert _del_rol(rol) == {"escritorio.acceder"}, rol


def test_el_administrador_de_ti_no_lo_tiene(db):
    assert _del_rol("Administrador") == set()
    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    assert _del_rol("Administrador") == set()
    assert _del_rol("Superusuario") == {"escritorio.acceder"}


def test_el_administrador_de_ti_no_entra(courier):
    ti = _cuenta("admin_ti", {courier: ["Administrador"]})
    assert _cliente(ti, courier).get(f"{BASE}/notes/").status_code == 403


# --- Acceso al módulo ------------------------------------------------------------------


def test_las_rutas_son_del_modulo_gestion_humana():
    assert modulo_de_ruta(f"{BASE}/notes/") == "gestion_humana"
    assert modulo_de_ruta(f"{BASE}/reminders/1/convert-to-task/") == "gestion_humana"


def test_el_rol_de_otra_empresa_no_cuenta(courier, seguridad):
    persona = _cuenta("persona", {courier: ["ANALISTA_CC"], seguridad: []})
    assert _cliente(persona, seguridad).get(f"{BASE}/notes/").status_code == 403


def test_con_el_modulo_apagado_no_hay_api(courier):
    from apps.authentication.services import AuthenticationService

    _cuenta("persona", {courier: ["ANALISTA_CC"]})
    tokens = AuthenticationService.authenticate_and_issue_tokens(
        identifier="persona", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.credentials(
        HTTP_AUTHORIZATION=f"Bearer {tokens['access']}", HTTP_X_EMPRESA=str(courier.pk)
    )
    assert cliente.get(f"{BASE}/reminders/").status_code == 200
    with usando_empresa(courier):
        EstadoModulo.objects.create(clave="gestion_humana", activo=False)
    respuesta = cliente.get(f"{BASE}/reminders/")
    assert respuesta.status_code == 403
    assert "modulo_apagado" in str(respuesta.json())


# --- Aislamiento por empresa ---------------------------------------------------------


def test_lo_de_otra_empresa_no_existe(courier, seguridad, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    ana = _cuenta("ana", {courier: ["ANALISTA_CC"], seguridad: ["ANALISTA_CC"]})
    nino = _cuenta("nino", {courier: ["ASISTENTE_GH"], seguridad: ["ASISTENTE_GH"]})
    nota = _cliente(ana, seguridad).post(
        f"{BASE}/notes/",
        {
            "recipient": nino.pk,
            "message": "De LaarSeguridad",
            "attachment": SimpleUploadedFile("acta.pdf", PDF_BYTES),
        },
        format="multipart",
    )
    assert nota.status_code == 201
    pk = nota.json()["id"]
    _cliente(nino, seguridad).post(f"{BASE}/notes/{pk}/replies/", {"message": "Ok"}, format="json")
    recordatorio = _cliente(ana, seguridad).post(
        f"{BASE}/reminders/",
        {
            "title": "De LaarSeguridad",
            "due_at": (timezone.now() - timedelta(minutes=1)).isoformat(),
        },
        format="json",
    )
    rid = recordatorio.json()["id"]

    for persona in (ana, nino):
        cliente = _cliente(persona, courier)
        for vista in ("desk", "archive", "sent"):
            assert cliente.get(f"{BASE}/notes/?view={vista}").json() == []
        for ruta in ("", "replies/", "history/", "attachment/"):
            assert cliente.get(f"{BASE}/notes/{pk}/{ruta}").status_code == 404, ruta
        assert cliente.get(f"{BASE}/reminders/").json() == []
        assert cliente.get(f"{BASE}/reminders/{rid}/").status_code == 404
        assert cliente.get(f"{BASE}/search/?q=LaarSeguridad").json() == {
            "notes": [],
            "reminders": [],
        }
        assert cliente.get(f"{BASE}/notes/unread-count/").json() == {"unread": 0}
    assert (
        _cliente(nino, courier)
        .patch(f"{BASE}/notes/{pk}/", {"action": "archive"}, format="json")
        .status_code
        == 404
    )

    with usando_empresa(courier):
        assert not DeskNote.objects.exists() and not DeskNoteReply.objects.exists()
        assert not PersonalReminder.objects.exists() and not DeskAuditLog.objects.exists()
    with usando_empresa(seguridad):
        assert DeskNote.objects.get().archived is False
        assert DeskNoteReply.objects.count() == 1


def test_no_se_deja_una_nota_a_alguien_de_otra_empresa(courier, seguridad):
    ana = _cuenta("ana", {courier: ["ANALISTA_CC"]})
    de_otra = _cuenta("otra", {seguridad: ["ANALISTA_CC"]})
    respuesta = _cliente(ana, courier).post(
        f"{BASE}/notes/", {"recipient": de_otra.pk, "message": "Hola"}, format="json"
    )
    assert respuesta.status_code == 400
    ids = {p["id"] for p in _cliente(ana, courier).get(f"{BASE}/notes/recipients/").json()}
    assert de_otra.pk not in ids


def test_el_aviso_del_ciclo_va_a_la_empresa_del_recordatorio(
    courier, seguridad, django_capture_on_commit_callbacks
):
    """El ciclo corre sin petición: cada aviso queda en la empresa de su
    recordatorio, no en ninguna otra."""
    from apps.escritorio.services import avisar_vencidos
    from apps.notificaciones.models import Notificacion

    ana = _cuenta("ana", {courier: ["ANALISTA_CC"], seguridad: ["ANALISTA_CC"]})
    with usando_empresa(seguridad):
        PersonalReminder.objects.create(
            user=ana, title="Firmar", due_at=timezone.now() - timedelta(minutes=1)
        )
    with django_capture_on_commit_callbacks(execute=True):
        assert avisar_vencidos() == 1
    aviso = Notificacion.objects.todas().get(usuario=ana, tipo="escritorio.recordatorio")
    assert aviso.empresa_id == seguridad.pk
