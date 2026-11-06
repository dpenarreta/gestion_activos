"""Fixtures de Reuniones.

Como en las pruebas de Mejora continua (`apps/mejora_continua/tests/conftest.py`):

- Cada prueba corre dentro de una empresa (fixture global de `backend/conftest.py`).
- Cada cuenta que se crea nace con membresía en esa empresa (sin roles): los
  roles de Gestión Humana se asignan como roles globales (`user.groups`).

Los datos son de un equipo de prueba con nombres realistas (tildes, eñes), sin
datos reales.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.db.models.signals import post_save
from django.utils import timezone
from rest_framework.test import APIClient

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.reuniones.models import Meeting, MeetingInvitee
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

BASE = "/api/v1/reuniones"
ENLACE = "https://us05web.zoom.us/j/81234567890?pwd=AbCdEf"


def _unir_a_la_empresa(sender, instance, created, **kwargs):
    empresa = empresa_actual()
    if not created or empresa is None or empresa is SIN_EMPRESA:
        return
    MembresiaEmpresa.objects.get_or_create(
        usuario=instance, empresa=empresa, defaults={"es_predeterminada": True}
    )


@pytest.fixture(autouse=True)
def _cuentas_de_la_empresa(db):
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="reuniones_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="reuniones_tests_unir")


def make_user(username: str, role: str | None = None, *, first_name: str = "", **extra) -> User:
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name=first_name,
        **extra,
    )
    if role:
        user.groups.set([Group.objects.get(name=role)])
    return user


def client_for(user: User) -> APIClient:
    """Cliente con la cuenta recién leída (los permisos se memorizan)."""
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


def manana(horas: int = 10):
    return (timezone.now() + timedelta(days=1)).replace(
        hour=horas, minute=0, second=0, microsecond=0
    )


def reunion_de(anfitrion: User, *invitados: User, **extra) -> Meeting:
    datos = {
        "title": "Comité de clima laboral — Peñaherrera",
        "host": anfitrion,
        "meeting_date": manana(),
        "duration": 45,
        "join_url": ENLACE,
        **extra,
    }
    meeting = Meeting.objects.create(**datos)
    for persona in invitados:
        MeetingInvitee.objects.create(meeting=meeting, user=persona)
    return meeting


@pytest.fixture
def jefa():
    """Programa reuniones (`reuniones.crear`)."""
    return make_user("jnacional", "JEFE_NACIONAL", first_name="Jimena")


@pytest.fixture
def ana():
    return make_user("anunez", "ANALISTA_CC", first_name="Ana")


@pytest.fixture
def nino():
    return make_user("nnoboa", "ASISTENTE_GH", first_name="Niño")


@pytest.fixture
def externa():
    """Del departamento, pero sin invitación."""
    return make_user("eespana", "ANALISTA_SELECCION", first_name="Eugenia")


@pytest.fixture
def admin_gh():
    return make_user("admingh", ADMIN_GH, first_name="Adela")


@pytest.fixture
def ajena():
    """Cuenta de la empresa sin ningún rol de Gestión Humana."""
    return make_user("contabilidad", first_name="Begoña")
