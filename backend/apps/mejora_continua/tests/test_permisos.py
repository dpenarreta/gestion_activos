"""El bloque `mejora_continua` del catálogo y su reparto por rol
(`mejora_continua/0002` y `0003`, `crear_roles_iniciales`)."""

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command

from apps.permissions.catalog import PERMISSION_CATALOG
from apps.tasks.roles import ADMIN_GH

pytestmark = pytest.mark.django_db

CODENAMES = {
    "mejora_continua.acceder",
    "mejora_continua.ver_todas",
    "mejora_continua.gestionar",
}


def _del_rol(nombre: str) -> set[str]:
    rol = Group.objects.filter(name=nombre).first()
    if rol is None:
        return set()
    return set(
        rol.permissions.filter(codename__startswith="mejora_continua.").values_list(
            "codename", flat=True
        )
    )


def test_el_bloque_esta_en_el_catalogo_y_en_gestion_humana():
    bloque = PERMISSION_CATALOG["mejora_continua"]
    assert set(bloque["permissions"]) == CODENAMES
    assert bloque["grupo"]["id"] == "gestion_humana"
    assert (
        set(
            Permission.objects.filter(codename__startswith="mejora_continua.").values_list(
                "codename", flat=True
            )
        )
        == CODENAMES
    )


def test_no_se_mezcla_con_el_buzon_de_sugerencias():
    """Decisión del usuario: Mejora continua es un módulo aparte; el buzón de
    Institucional es solo para opiniones y errores del sistema."""
    assert not set(PERMISSION_CATALOG["sugerencias"]["permissions"]) & CODENAMES
    assert PERMISSION_CATALOG["sugerencias"]["grupo"]["id"] != "gestion_humana"


def test_reparto_por_rol():
    assert _del_rol(ADMIN_GH) == CODENAMES
    assert _del_rol("JEFE_NACIONAL") == CODENAMES
    assert _del_rol("COORDINADOR_NACIONAL") == CODENAMES
    for rol in (
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
    ):
        assert _del_rol(rol) == {"mejora_continua.acceder"}, rol


def test_el_administrador_de_ti_no_los_tiene():
    # Lo que dejó la migración `0003` y lo que reescribe el comando.
    assert _del_rol("Administrador") == set()
    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    assert _del_rol("Administrador") == set()
    assert _del_rol("Superusuario") == CODENAMES
