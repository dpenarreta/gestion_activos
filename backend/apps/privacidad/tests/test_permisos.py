"""Los permisos de protección de datos: en el catálogo, en su grupo y en los
roles que los atienden (`privacidad/0002` y `0003`), y el de editar los
textos (`privacidad.textos`, US-004: `permissions/0059` y `roles/0045`)."""

import pytest
from django.contrib.auth.models import Group

from apps.permissions.catalog import PERMISSION_CATALOG
from apps.tasks.roles import ADMIN_GH

pytestmark = pytest.mark.django_db

SOLICITUDES = {"privacidad.ver", "privacidad.atender"}
TEXTOS = "privacidad.textos"
#: Quien tenía cualquiera de estos editaba algún texto antes de US-004 y por
#: eso recibe `privacidad.textos` (CA-9).
EDITABAN_ALGUN_TEXTO = (
    "privacidad.atender",
    "configuracion.textos_legales",
    "roles_pago.configurar",
    "codigos.acuerdo",
)


def _de(rol: str) -> set[str]:
    return set(
        Group.objects.get(name=rol)
        .permissions.filter(codename__startswith="privacidad.")
        .values_list("codename", flat=True)
    )


def test_estan_en_el_catalogo_dentro_de_auditoria():
    bloque = PERMISSION_CATALOG["privacidad"]
    assert set(bloque["permissions"]) == SOLICITUDES | {TEXTOS}
    assert bloque["permissions"][TEXTOS] == "Editar textos de protección de datos"
    assert bloque["grupo"]["id"] == "auditoria"
    assert bloque["grupo"]["alcance"] == "general"


def test_los_atiende_gestion_humana_y_ti_solo_edita_los_textos():
    """Las solicitudes de derechos las atiende Gestión Humana, no TI
    (09/11/2026); los textos los edita también el Administrador de TI
    (decisión del usuario del 11/11/2026, US-004)."""
    assert _de(ADMIN_GH) == SOLICITUDES | {TEXTOS}
    if Group.objects.filter(name="Superusuario").exists():
        assert _de("Superusuario") >= SOLICITUDES
    if Group.objects.filter(name="Administrador").exists():
        assert _de("Administrador") <= {TEXTOS}


def test_ningun_rol_de_cargo_trae_las_solicitudes_por_defecto():
    """Pedir y descargar lo propio no pide permiso: nadie más necesita ver ni
    atender las solicitudes."""
    con_permiso = set(
        Group.objects.filter(permissions__codename__in=SOLICITUDES)
        .values_list("name", flat=True)
        .distinct()
    )
    assert con_permiso <= {ADMIN_GH, "Superusuario"}


def test_editar_textos_lo_tiene_quien_ya_editaba_alguno():
    """Nadie pierde la edición: cada rol con alguno de los permisos de antes
    tiene `privacidad.textos`; y nadie más lo recibe por la migración, salvo
    el Administrador de TI."""
    editaban = set(
        Group.objects.filter(permissions__codename__in=EDITABAN_ALGUN_TEXTO)
        .values_list("name", flat=True)
        .distinct()
    )
    con_textos = set(
        Group.objects.filter(permissions__codename=TEXTOS).values_list("name", flat=True)
    )
    assert editaban - {"Administrador"} <= con_textos
    assert con_textos - editaban <= {"Administrador", "Superusuario"}
