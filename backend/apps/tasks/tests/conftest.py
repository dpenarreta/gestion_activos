"""Fixtures de Tareas y Equipo, portadas de Nexo y adaptadas a la intranet.

Lo que cambia frente a Nexo:

- Cada prueba corre dentro de una empresa (fixture global `_empresa_de_pruebas`
  de `backend/conftest.py`), como corre producción.
- En Nexo toda cuenta usaba Tareas. Aquí hace falta `tareas.acceder`, así que
  cada cuenta que las pruebas crean nace con membresía en la empresa de
  pruebas y un rol mínimo que solo da ese permiso (`ROL_BASE`). Los roles de
  Gestión Humana que las pruebas asignan con `user.groups.set(...)` valen como
  roles globales, que la intranet también reconoce.
- La jerarquía ya no es la tabla rol → rol de Nexo sino el organigrama: las
  pruebas que necesitan «X es jefe de Y» lo arman con `organigrama(...)`.
- El ADMINISTRADOR de Nexo (superusuario) es aquí quien tiene
  `tareas.administrar`: el rol «Administrador de Gestión Humana».
- Los avisos van a la campana de la intranet (`Notificacion`): el mensaje de
  Nexo queda en `resumen` y el enlace lleva el id de la tarea.
"""

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

ROL_BASE = "Colaborador de Tareas (pruebas)"


def _rol_base() -> Group:
    rol, creado = Group.objects.get_or_create(name=ROL_BASE)
    if creado:
        rol.permissions.add(
            Permission.objects.get(content_type__app_label="permissions", codename="tareas.acceder")
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
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="tasks_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="tasks_tests_unir")


@pytest.fixture(autouse=True)
def immediate_on_commit(monkeypatch):
    """Los avisos salen en `transaction.on_commit`; dentro de la prueba (una
    transacción que nunca se confirma) se ejecutan al instante."""
    monkeypatch.setattr("apps.tasks.services.transaction.on_commit", lambda fn, *a, **k: fn())


def grant_permission(user: User, codename: str) -> None:
    user.user_permissions.add(
        Permission.objects.get(content_type__app_label="permissions", codename=codename)
    )


def set_role(user: User, role: str) -> None:
    """El rol de Gestión Humana, como rol global (lo que en Nexo era
    `user.groups.set([...])`)."""
    user.groups.set([Group.objects.get(name=role)])


def make_admin(username: str = "admin_gh") -> User:
    """Quien administra Tareas (en Nexo, el ADMINISTRADOR)."""
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )
    set_role(user, ADMIN_GH)
    return user


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
    """`jefe` en un cargo y cada subordinado en un cargo que le reporta
    directamente. Devuelve el cargo del jefe."""
    perfil = DatosDeContacto.objects.filter(usuario=jefe, cargo__isnull=False).first()
    cargo_jefe = perfil.cargo if perfil else cargo(f"Jefatura de {jefe.username}")
    poner_en_cargo(jefe, cargo_jefe)
    for persona in subordinados:
        poner_en_cargo(persona, cargo(f"Cargo de {persona.username}", jefe=cargo_jefe))
    return cargo_jefe


def notifications(user: User | None = None):
    """Avisos de Tareas en la campana."""
    qs = Notificacion.objects.filter(tipo__startswith="tareas.").order_by("pk")
    if user is not None:
        qs = qs.filter(usuario=user)
    return qs


def task_id_of(notification: Notificacion) -> int:
    return int(notification.enlace.rstrip("/").rsplit("/", 1)[1])
