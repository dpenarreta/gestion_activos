"""Fixtures de los informes ejecutivos.

Como en las pruebas del KPI (`apps/analytics/tests/conftest.py`):

- Cada prueba corre dentro de una empresa (fixture global de `backend/conftest.py`).
- Cada cuenta que se crea nace con membresía en esa empresa (sin roles): los
  roles de Gestión Humana se asignan como roles globales (`user.groups`).
- La jerarquía es el organigrama: `organigrama(jefe, *subordinados)`.

Los datos son de un equipo de prueba con nombres realistas (tildes, eñes), sin
datos reales.
"""

from datetime import UTC, datetime

import pytest
from django.contrib.auth.models import Group
from django.db.models.signals import post_save
from rest_framework.test import APIClient

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Cargo, DatosDeContacto, NivelJerarquico, UnidadOrganizacional
from apps.tasks.models import Task, TaskActivity
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User


def _unir_a_la_empresa(sender, instance, created, **kwargs):
    empresa = empresa_actual()
    if not created or empresa is None or empresa is SIN_EMPRESA:
        return
    MembresiaEmpresa.objects.get_or_create(
        usuario=instance, empresa=empresa, defaults={"es_predeterminada": True}
    )


@pytest.fixture(autouse=True)
def _cuentas_de_la_empresa(db):
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="informes_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="informes_tests_unir")


def make_user(username: str, role: str | None = None, *, first_name: str = "", **extra) -> User:
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name=first_name,
        **extra,
    )
    # Con historial «desde siempre»: si no, la base de quien se acaba de crear
    # se prorratea desde hoy y los meses pasados quedarían en cero.
    User.objects.filter(pk=user.pk).update(created_at=datetime(2020, 1, 1, tzinfo=UTC))
    user.refresh_from_db()
    if role:
        user.groups.set([Group.objects.get(name=role)])
    return user


def client_for(user: User) -> APIClient:
    """Cliente con la cuenta recién leída (los permisos se memorizan)."""
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


def _unidad(nombre: str) -> UnidadOrganizacional:
    nivel, _ = NivelJerarquico.objects.get_or_create(nombre="Área", defaults={"orden": 3})
    return UnidadOrganizacional.objects.create(nombre=nombre, nivel=nivel)


def poner_en_cargo(user: User, cargo: Cargo | None) -> None:
    DatosDeContacto.objects.update_or_create(
        usuario=user, empresa=empresa_actual(), defaults={"cargo": cargo}
    )


def organigrama(jefe: User, *subordinados: User, unidad: str | None = None) -> Cargo:
    """`jefe` en un cargo y cada subordinado en uno que le reporta. Con
    `unidad`, los cargos de los subordinados cuelgan de esa unidad."""
    perfil = DatosDeContacto.objects.filter(usuario=jefe, cargo__isnull=False).first()
    cargo_jefe = perfil.cargo if perfil else Cargo.objects.create(nombre=f"Jefatura {jefe.pk}")
    poner_en_cargo(jefe, cargo_jefe)
    area = _unidad(unidad) if unidad else None
    for persona in subordinados:
        poner_en_cargo(
            persona,
            Cargo.objects.create(nombre=f"Cargo {persona.pk}", jefe=cargo_jefe, unidad=area),
        )
    return cargo_jefe


def tarea(user: User, *, end_date, status=Task.Status.PENDIENTE, **extra) -> Task:
    datos = {
        "title": "Conciliación de nómina — Peñaherrera",
        "priority": Task.Priority.MEDIA,
        "frequency": Task.Frequency.PUNTUAL,
        "type": Task.Type.FIJA,
        "start_date": end_date.replace(day=1),
        "end_date": end_date,
        "estimated_hours": 5,
        "real_hours": 0.0,
        "progress": 0,
        "assigned_to": user,
        "created_by": user,
        "status": status,
        **extra,
    }
    return Task.objects.create(**datos)


def actividad(task: Task, author: User, *, en, reason="CONSULTA_OPERACIONES", duration=60):
    act = TaskActivity.objects.create(task=task, author=author, reason=reason, duration=duration)
    TaskActivity.objects.filter(pk=act.pk).update(created_at=en)
    act.refresh_from_db()
    return act


def congelar(monkeypatch, instante: datetime) -> None:
    """Congela el reloj de Django (`timezone.now()`)."""
    monkeypatch.setattr("django.utils.timezone.now", lambda: instante)


@pytest.fixture
def jefa():
    return make_user("jnacional", "JEFE_NACIONAL", first_name="Jimena")


@pytest.fixture
def coordinadora():
    return make_user("cnacional", "COORDINADOR_NACIONAL", first_name="Coral")


@pytest.fixture
def ana():
    return make_user("anunez", "ANALISTA_CC", first_name="Ana")


@pytest.fixture
def nino():
    return make_user("nnoboa", "ASISTENTE_GH", first_name="Niño")


@pytest.fixture
def externo():
    """Alguien del departamento que no depende de la coordinadora."""
    return make_user("eespana", "ANALISTA_SELECCION", first_name="Eugenia")


@pytest.fixture
def admin_gh():
    return make_user("admingh", ADMIN_GH, first_name="Adela")


@pytest.fixture
def sin_permiso():
    return make_user("sinpermiso", "ASISTENTE_GH", first_name="Sofía")


@pytest.fixture
def equipo(coordinadora, ana, nino):
    """La coordinadora con Ana y Niño a su cargo, en la unidad «Bienestar»."""
    organigrama(coordinadora, ana, nino, unidad="Bienestar")
    return [ana, nino]
