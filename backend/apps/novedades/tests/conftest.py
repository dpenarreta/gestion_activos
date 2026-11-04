"""Fixtures del módulo, portadas de Nexo y adaptadas a la intranet.

Lo que cambia frente a Nexo:

- Cada prueba corre dentro de una empresa (fixture global `_empresa_de_pruebas`
  de `backend/conftest.py`), como corre producción.
- Los roles se asignan en la **membresía de la empresa** (`MembresiaEmpresa.
  roles`), no en `user.groups`: es el camino normal de la intranet y el que
  `access.operational_role_of` tiene que reconocer. `global_role=True` usa en
  cambio el rol global.
- El Administrador del módulo ya no es el superusuario: es una cuenta con el
  rol «Administrador», que trae todo `novedades.*` (migración
  `0002_roles_operativos`).
- Los avisos van a la campana de la intranet (`Notificacion`): el mensaje de
  Nexo queda en `resumen` y la categoría en el tipo (`novedades.<categoría>`).
- Los feriados salen del calendario institucional (`EventoCalendario`).
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group, Permission
from rest_framework.test import APIClient

from apps.empresas.contexto import empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.notificaciones.models import Notificacion
from apps.novedades.access import NovedadesAccess
from apps.novedades.models import PendingNotification
from apps.organizacion.models import EventoCalendario
from apps.users.models import User

TODAY = date(2026, 10, 12)  # período vigente: Octubre 2026 (23/09 → 22/10)


# Reloj coherente con TODAY (lunes 12/10/2026, 12:00 en Ecuador): el plazo por
# fecha de trabajo compara el día del negocio con el instante actual, y
# mezclar un día fijo con el reloj real hacía depender los tests de la hora.
NOW = datetime(2026, 10, 12, 17, tzinfo=dt_timezone.utc)

#: Nombres de rol de Nexo que en la intranet tienen otro nombre.
ROLE_ALIASES = {"ADMINISTRADOR": "Administrador"}


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("apps.novedades.services.today", lambda: TODAY)
    monkeypatch.setattr("apps.novedades.views.today", lambda: TODAY)
    monkeypatch.setattr("django.utils.timezone.now", lambda: NOW)


@pytest.fixture(autouse=True)
def immediate_on_commit(monkeypatch):
    """Las notificaciones se envían en `transaction.on_commit`; dentro del
    test (una transacción que nunca se confirma) se ejecutan al instante."""
    monkeypatch.setattr("apps.novedades.services.transaction.on_commit", lambda fn, *a, **k: fn())
    # El correo de salida corre en un hilo aparte en producción; en tests, en
    # el mismo hilo (otro hilo no ve la transacción del test).
    monkeypatch.setattr("apps.novedades.services.CollaboratorMailService.run_async", False)


def _role(name: str) -> Group:
    name = ROLE_ALIASES.get(name, name)
    group, _ = Group.objects.get_or_create(name=name)
    if name == "Administrador":
        # En una base nueva el rol existe solo si se sembró; aquí se asegura
        # que tenga lo que le da la migración del módulo.
        group.permissions.add(
            *Permission.objects.filter(
                content_type__app_label="permissions", codename__startswith="novedades."
            )
        )
    return group


def _user(username, role, *, superuser=False, global_role=False):
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="clave-de-prueba-123",
        first_name=username.title(),
    )
    group = _role(role)
    membresia = MembresiaEmpresa.objects.create(
        usuario=user, empresa=empresa_actual(), es_predeterminada=True
    )
    if global_role:
        user.groups.set([group])
    else:
        membresia.roles.set([group])
    if superuser:
        user.is_superuser = True
        user.save(update_fields=["is_superuser"])
    return user


@pytest.fixture
def admin(db):
    return _user("admin", "ADMINISTRADOR")


@pytest.fixture
def supervisor(db):
    return _user("sup1", "SUPERVISOR_OPERACIONES")


@pytest.fixture
def supervisor2(db):
    return _user("sup2", "SUPERVISOR_OPERACIONES")


@pytest.fixture
def assistant(db):
    return _user("asis", "ASISTENTE_OPERACIONES")


@pytest.fixture
def other_user(db):
    return _user("otro", "ASISTENTE_GH")


def access(user):
    """Usuario recién leído de la base, como en cada request real (Django
    cachea los permisos en la instancia: ver `get_user_permission_codenames`)."""
    user = User.objects.get(pk=user.pk)
    return NovedadesAccess.for_user(user)


@pytest.fixture
def client_for():
    def _client(user):
        client = APIClient()
        client.force_authenticate(user=User.objects.get(pk=user.pk))
        return client

    return _client


def holiday(day: date, name: str = "Feriado") -> EventoCalendario:
    """Un feriado del calendario institucional de la empresa activa."""
    return EventoCalendario.objects.create(
        titulo=name, tipo=EventoCalendario.Tipo.FERIADO, fecha=day
    )


def alerts(user=None, category=None):
    """Avisos de la campana del módulo: `(mensaje, categoría)`."""
    qs = Notificacion.objects.filter(tipo__startswith="novedades.").order_by("pk")
    if user is not None:
        qs = qs.filter(usuario=user)
    if category is not None:
        qs = qs.filter(tipo=f"novedades.{category}")
    return [(n.resumen, n.tipo.split(".", 1)[1]) for n in qs]


def admin_notifications(admin_user):
    return [message for message, _ in alerts(admin_user)]


def delivered_dedup_keys(prefix: str = "") -> set[str]:
    """Claves de los avisos deduplicados ya entregados (en Nexo vivían en la
    notificación misma)."""
    return set(
        PendingNotification.objects.filter(
            delivered_at__isnull=False, dedup_key__startswith=prefix
        ).values_list("dedup_key", flat=True)
    )
