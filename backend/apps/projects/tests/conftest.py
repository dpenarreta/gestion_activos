"""Fixtures de Proyectos, portadas de Nexo y adaptadas a la intranet.

Lo que cambia frente a Nexo (igual que en `apps/tasks/tests/conftest.py`):

- Cada prueba corre dentro de una empresa (fixture global de
  `backend/conftest.py`). Cada cuenta que se crea nace con membresía en ella y
  un rol mínimo que solo da `proyectos_gh.acceder`, para que pueda ser
  responsable o participante. Los roles de Gestión Humana que las pruebas de
  Nexo asignan con `user.groups.set(...)` valen como roles globales.
- El «liderazgo» de Nexo (nivel >= 3) ya no ve todo: ve lo de su equipo en el
  organigrama (`organigrama(...)`); quien ve todo es el Administrador de
  Gestión Humana (`proyectos_gh.administrar`).
- Los archivos de los documentos van a una carpeta temporal.
"""

import base64

import pytest
from django.contrib.auth.models import Group, Permission
from django.db.models.signals import post_save
from rest_framework.test import APIClient

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.notificaciones.models import Notificacion
from apps.organizacion.models import Cargo, DatosDeContacto
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

ROL_BASE = "Participante de Proyectos (pruebas)"

#: Un PDF mínimo: lo que importa es la firma (`%PDF-`), que se valida.
PDF_BYTES = b"%PDF-1.4\n% documento de prueba\n%%EOF\n"
PDF_B64 = base64.b64encode(PDF_BYTES).decode()
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def _rol_base() -> Group:
    rol, creado = Group.objects.get_or_create(name=ROL_BASE)
    if creado:
        rol.permissions.add(
            Permission.objects.get(
                content_type__app_label="permissions", codename="proyectos_gh.acceder"
            )
        )
    return rol


def _unir_a_la_empresa(sender, instance, created, **kwargs):
    empresa = empresa_actual()
    if not created or empresa is None or empresa is SIN_EMPRESA:
        return
    membresia, _ = MembresiaEmpresa.objects.get_or_create(
        usuario=instance, empresa=empresa, defaults={"es_predeterminada": True}
    )
    membresia.roles.add(_rol_base())


@pytest.fixture(autouse=True)
def _cuentas_del_equipo(db):
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="projects_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="projects_tests_unir")


@pytest.fixture(autouse=True)
def immediate_on_commit(monkeypatch):
    """Los avisos y el borrado de archivos salen en `transaction.on_commit`;
    dentro de la prueba (una transacción que nunca se confirma) corren ya."""
    monkeypatch.setattr("apps.projects.services.transaction.on_commit", lambda fn, *a, **k: fn())
    monkeypatch.setattr("apps.projects.recovery.transaction.on_commit", lambda fn, *a, **k: fn())


@pytest.fixture(autouse=True)
def _archivos_temporales(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


def make_user(username: str, group_name: str | None = None, **extra) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", **extra
    )
    if group_name:
        user.groups.set([Group.objects.get(name=group_name)])
    return user


def make_admin(username: str = "admin_gh") -> User:
    """Quien administra Proyectos (en Nexo, el ADMINISTRADOR)."""
    return make_user(username, ADMIN_GH)


def client_for(user: User) -> APIClient:
    """Cliente con la cuenta recién leída de la base, como en cada petición
    real (los permisos se memorizan en la instancia)."""
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


def cargo(nombre: str, jefe: Cargo | None = None) -> Cargo:
    return Cargo.objects.create(nombre=nombre, jefe=jefe)


def poner_en_cargo(user: User, en: Cargo | None) -> None:
    DatosDeContacto.objects.update_or_create(
        usuario=user, empresa=empresa_actual(), defaults={"cargo": en}
    )


def organigrama(jefe: User, *subordinados: User) -> Cargo:
    """`jefe` en un cargo y cada subordinado en uno que le reporta."""
    perfil = DatosDeContacto.objects.filter(usuario=jefe, cargo__isnull=False).first()
    cargo_jefe = perfil.cargo if perfil else cargo(f"Jefatura de {jefe.username}")
    poner_en_cargo(jefe, cargo_jefe)
    for persona in subordinados:
        poner_en_cargo(persona, cargo(f"Cargo de {persona.username}", jefe=cargo_jefe))
    return cargo_jefe


def notifications(user: User | None = None):
    qs = Notificacion.objects.filter(tipo__startswith="proyectos.").order_by("pk")
    if user is not None:
        qs = qs.filter(usuario=user)
    return qs


def project_payload(responsible: User, **overrides) -> dict:
    payload = {
        "name": "Rediseño de onboarding",
        "priority": "ALTA",
        "responsible": responsible.id,
        "start_date": "2026-08-01T00:00:00Z",
        "target_date": "2026-09-01T00:00:00Z",
        "target_time_hours": 40,
    }
    payload.update(overrides)
    return payload


def create_project(*, creator: User, responsible: User, **overrides):
    from apps.projects.models import Project

    response = client_for(creator).post(
        "/api/v1/projects/", project_payload(responsible, **overrides), format="json"
    )
    assert response.status_code == 201, response.data
    return Project.objects.get(id=response.data["id"])


@pytest.fixture
def leadership():
    """Nivel 3 en Nexo (Coordinador Nacional): aquí supervisa su equipo."""
    return make_user("coord_nac", "COORDINADOR_NACIONAL")


@pytest.fixture
def manager_level2():
    """Puede crear proyectos (`proyectos_gh.crear`)."""
    return make_user("analista", "ANALISTA_CC")


@pytest.fixture
def assistant_level1():
    """No puede crear proyectos."""
    return make_user("asistente", "ASISTENTE_GH")


@pytest.fixture
def stranger():
    return make_user("stranger", "ASISTENTE_SELECCION")


@pytest.fixture
def admin_gh():
    return make_admin()
