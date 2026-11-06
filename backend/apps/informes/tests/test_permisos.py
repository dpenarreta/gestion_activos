"""El bloque `informes_gh` del catálogo y su reparto por rol (`informes/0002` y
`0003`, `crear_roles_iniciales`)."""

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command

from apps.permissions.catalog import PERMISSION_CATALOG
from apps.tasks.roles import ADMIN_GH

pytestmark = pytest.mark.django_db

CODENAMES = {"informes_gh.ver", "informes_gh.generar", "informes_gh.administrar"}


def _del_rol(nombre: str) -> set[str]:
    rol = Group.objects.filter(name=nombre).first()
    if rol is None:
        return set()
    return set(
        rol.permissions.filter(codename__startswith="informes_gh.").values_list(
            "codename", flat=True
        )
    )


def test_el_bloque_esta_en_el_catalogo_y_en_gestion_humana():
    bloque = PERMISSION_CATALOG["informes_gh"]
    assert set(bloque["permissions"]) == CODENAMES
    assert bloque["grupo"]["id"] == "gestion_humana"
    assert (
        set(
            Permission.objects.filter(codename__startswith="informes_gh.").values_list(
                "codename", flat=True
            )
        )
        == CODENAMES
    )


def test_reparto_por_rol():
    assert _del_rol(ADMIN_GH) == CODENAMES
    assert _del_rol("JEFE_NACIONAL") == {"informes_gh.ver", "informes_gh.generar"}
    assert _del_rol("COORDINADOR_NACIONAL") == {"informes_gh.ver", "informes_gh.generar"}
    for rol in ("COORDINADOR_ZS", "ANALISTA_CC", "ASISTENTE_GH"):
        assert _del_rol(rol) == set()


def test_el_administrador_de_ti_no_los_tiene():
    # Lo que dejó la migración `0003` y lo que reescribe el comando.
    assert _del_rol("Administrador") == set()
    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    assert _del_rol("Administrador") == set()
    assert _del_rol("Superusuario") == CODENAMES
