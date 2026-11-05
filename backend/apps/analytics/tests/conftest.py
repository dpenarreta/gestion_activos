"""Fixtures del motor de KPI, portadas de Nexo y adaptadas a la intranet.

Lo que cambia frente a Nexo:

- Cada prueba corre dentro de una empresa (fixture global `_empresa_de_pruebas`
  de `backend/conftest.py`), como corre producción.
- En Nexo toda cuenta veía sus KPI. Aquí hace falta `kpi.acceder`, así que
  cada cuenta que las pruebas crean nace con membresía en la empresa de
  pruebas y un rol mínimo que solo da ese permiso (`ROL_BASE`, que no es un
  rol de Gestión Humana). Los roles de Gestión Humana que las pruebas asignan
  con `user.groups.set(...)` valen como roles globales.
- La jerarquía ya no es la tabla rol → rol de Nexo sino el organigrama: las
  pruebas que necesitan «X es jefe de Y» lo arman con `organigrama(...)`.
- El ADMINISTRADOR de Nexo (superusuario) es aquí el rol «Administrador de
  Gestión Humana» (`kpi.administrar` y, para el dato médico,
  `ausencias.medicas_ver`).
- Los feriados son eventos del calendario de la empresa (`feriado(...)`) y la
  fecha de inicio del KPI, `KpiStartDate` (`set_kpi_start(...)`).
"""

from datetime import date

import pytest
from django.contrib.auth.models import Group, Permission
from django.db.models.signals import post_save
from rest_framework.test import APIClient

from apps.analytics.models import KpiStartDate
from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Cargo, DatosDeContacto, EventoCalendario
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

ROL_BASE = "Colaborador de KPI (pruebas)"


def _rol_base() -> Group:
    rol, creado = Group.objects.get_or_create(name=ROL_BASE)
    if creado:
        rol.permissions.add(
            Permission.objects.get(content_type__app_label="permissions", codename="kpi.acceder")
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
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="analytics_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="analytics_tests_unir")


def set_role(user: User, role: str) -> User:
    """El rol de Gestión Humana, como rol global (lo que en Nexo era
    `user.groups.set([...])`)."""
    user.groups.set([Group.objects.get(name=role)])
    return user


def make_user(username: str, role: str | None = None, **extra) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!", **extra
    )
    if role:
        set_role(user, role)
    return user


def make_admin(username: str = "admin") -> User:
    """Quien administra el KPI (en Nexo, el ADMINISTRADOR / superusuario)."""
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
    """`jefe` en un cargo y cada subordinado en un cargo que le reporta
    directamente. Devuelve el cargo del jefe."""
    perfil = DatosDeContacto.objects.filter(usuario=jefe, cargo__isnull=False).first()
    cargo_jefe = perfil.cargo if perfil else cargo(f"Jefatura de {jefe.username}")
    poner_en_cargo(jefe, cargo_jefe)
    for persona in subordinados:
        poner_en_cargo(persona, cargo(f"Cargo de {persona.username}", jefe=cargo_jefe))
    return cargo_jefe


def feriado(dia: date, nombre: str = "Feriado") -> EventoCalendario:
    """Un feriado del calendario de la empresa (en Nexo, `Holiday`)."""
    return EventoCalendario.objects.create(
        titulo=nombre, tipo=EventoCalendario.Tipo.FERIADO, fecha=dia
    )


def set_kpi_start(user: User, inicio) -> None:
    """La fecha de inicio del KPI (en Nexo, `user.kpi_start_date = ...`)."""
    if inicio is None:
        KpiStartDate.objects.filter(user=user).delete()
        return
    KpiStartDate.objects.update_or_create(user=user, defaults={"kpi_start_date": inicio})


@pytest.fixture(autouse=True)
def _jerarquia_de_nexo(request):
    """En Nexo la Coordinación Nacional veía a los analistas por su rol
    (`RoleVisibility`) y las pruebas lo daban por hecho al pedir los dos
    fixtures. Aquí la visibilidad es el organigrama: cuando una prueba pide
    `coordinador_nacional` y `analista`, el analista pasa a depender de ella.
    Las pruebas de «fuera de la jerarquía» no piden ese par."""
    pedidos = set(request.fixturenames)
    if {"coordinador_nacional", "analista"} <= pedidos:
        organigrama(
            request.getfixturevalue("coordinador_nacional"), request.getfixturevalue("analista")
        )


def mismo_cargo(*users: User) -> Cargo:
    """Todas en el mismo cargo del organigrama (los pares del Benchmark
    Inteligente; en Nexo, el mismo rol)."""
    en = cargo(f"Cargo compartido {users[0].username}")
    for user in users:
        poner_en_cargo(user, en)
    return en


def freeze_now(monkeypatch, instante) -> None:
    """Congela el reloj de Django (`timezone.now()`) en `instante`."""
    monkeypatch.setattr("django.utils.timezone.now", lambda: instante)
