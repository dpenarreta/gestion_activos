"""Los permisos de cambiar la contraseña y de restablecerla a la temporal
(US-015, CA-4): existen en el catálogo, la migración `roles/0052` los da a
«Administrador» y «Superusuario» y los roles iniciales los traen."""

import importlib

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command

from apps.permissions.catalog import PERMISSION_CATALOG

pytestmark = pytest.mark.django_db

NUEVOS = ("usuarios.cambiar_password", "usuarios.clave_temporal")


def test_estan_en_el_catalogo_con_sus_textos():
    permisos = PERMISSION_CATALOG["usuarios"]["permissions"]
    assert permisos["usuarios.cambiar_password"] == (
        "Cambiar la contraseña de otra cuenta por una indicada"
    )
    assert permisos["usuarios.clave_temporal"] == (
        "Restablecer la contraseña de otra cuenta a la clave temporal"
    )


def test_la_migracion_0052_los_da_a_administrador_y_superusuario():
    migracion = importlib.import_module(
        "apps.roles.migrations.0052_permisos_cambiar_y_clave_temporal"
    )
    nuevos = list(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=NUEVOS)
    )
    assert len(nuevos) == 2
    administrador, _ = Group.objects.get_or_create(name="Administrador")
    superusuario, _ = Group.objects.get_or_create(name="Superusuario")
    otro = Group.objects.create(name="Mesa de ayuda (prueba)")
    for rol in (administrador, superusuario):
        rol.permissions.remove(*nuevos)

    migracion.conceder(django_apps, None)
    migracion.conceder(django_apps, None)  # idempotente

    for rol in (administrador, superusuario):
        for permiso in nuevos:
            assert rol.permissions.filter(pk=permiso.pk).count() == 1, (rol.name, permiso)
    assert not otro.permissions.filter(pk__in=[p.pk for p in nuevos]).exists()

    # Se pueden dar a otros roles desde Roles; revertir los quita de todos.
    otro.permissions.add(*nuevos)
    migracion.retirar(django_apps, None)
    assert not Group.objects.filter(permissions__in=nuevos).exists()


def test_los_roles_iniciales_los_traen():
    call_command("crear_roles_iniciales", verbosity=0)

    for nombre in ("Administrador", "Superusuario"):
        codenames = set(
            Group.objects.get(name=nombre).permissions.values_list("codename", flat=True)
        )
        assert set(NUEVOS) <= codenames, nombre
