"""Los permisos de protección de datos: en el catálogo, en su grupo y en los
roles que los atienden (`privacidad/0002` y `0003`)."""

import pytest
from django.contrib.auth.models import Group

from apps.permissions.catalog import PERMISSION_CATALOG
from apps.tasks.roles import ADMIN_GH

pytestmark = pytest.mark.django_db


def _de(rol: str) -> set[str]:
    return set(
        Group.objects.get(name=rol)
        .permissions.filter(codename__startswith="privacidad.")
        .values_list("codename", flat=True)
    )


def test_estan_en_el_catalogo_dentro_de_auditoria():
    bloque = PERMISSION_CATALOG["privacidad"]
    assert set(bloque["permissions"]) == {"privacidad.ver", "privacidad.atender"}
    assert bloque["grupo"]["id"] == "auditoria"
    assert bloque["grupo"]["alcance"] == "general"


def test_los_atiende_gestion_humana_y_no_ti():
    assert _de(ADMIN_GH) == {"privacidad.ver", "privacidad.atender"}
    if Group.objects.filter(name="Superusuario").exists():
        assert _de("Superusuario") == {"privacidad.ver", "privacidad.atender"}
    if Group.objects.filter(name="Administrador").exists():
        assert _de("Administrador") == set()


def test_ningun_rol_de_cargo_los_trae_por_defecto():
    """Pedir y descargar lo propio no pide permiso: nadie más necesita el rol."""
    con_permiso = set(
        Group.objects.filter(permissions__codename__startswith="privacidad.")
        .values_list("name", flat=True)
        .distinct()
    )
    assert con_permiso <= {ADMIN_GH, "Superusuario"}
