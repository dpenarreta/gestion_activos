"""Fixtures de Ausencias, portadas de Nexo y adaptadas a la intranet.

En Nexo estos endpoints exigían `is_superuser`. Aquí, el permiso del
catálogo: el «administrador» de las pruebas de Nexo es el Administrador de
Gestión Humana (todo `ausencias.*`). Cada cuenta que se crea nace con
membresía en la empresa de pruebas (sin permisos), para poder ser titular de
una ausencia.
"""

import pytest
from django.contrib.auth.models import Group, Permission
from django.db.models.signals import post_save
from rest_framework.test import APIClient

from apps.empresas.contexto import SIN_EMPRESA, empresa_actual
from apps.empresas.models import MembresiaEmpresa
from apps.organizacion.models import Cargo, DatosDeContacto
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
    post_save.connect(_unir_a_la_empresa, sender=User, dispatch_uid="ausencias_tests_unir")
    yield
    post_save.disconnect(sender=User, dispatch_uid="ausencias_tests_unir")


def make_user(username: str, group_name: str | None = None, **extra) -> User:
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="Sup3r-Secr3t!",
        first_name=extra.pop("first_name", "Ana"),
        **extra,
    )
    if group_name:
        user.groups.set([Group.objects.get(name=group_name)])
    return user


def make_admin(username: str = "admin_gh") -> User:
    return make_user(username, ADMIN_GH)


def grant(user: User, *codenames: str) -> None:
    for codename in codenames:
        user.user_permissions.add(
            Permission.objects.get(content_type__app_label="permissions", codename=codename)
        )


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


def organigrama(jefe: User, *subordinados: User) -> Cargo:
    arriba = Cargo.objects.create(nombre=f"Jefatura de {jefe.username}")
    DatosDeContacto.objects.update_or_create(
        usuario=jefe, empresa=empresa_actual(), defaults={"cargo": arriba}
    )
    for persona in subordinados:
        DatosDeContacto.objects.update_or_create(
            usuario=persona,
            empresa=empresa_actual(),
            defaults={
                "cargo": Cargo.objects.create(nombre=f"Cargo de {persona.username}", jefe=arriba)
            },
        )
    return arriba
