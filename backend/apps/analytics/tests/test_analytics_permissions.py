"""Permisos del motor por rol (portado de Nexo, `test_analytics_permissions`).

En Nexo, `can_view_operational_risk` era un whitelist de roles
(`CAN_VIEW_OPERATIONAL_RISK`). Aquí es el permiso del catálogo
`inteligencia_preventiva.ver`, sembrado por `analytics/0002` con los mismos
roles; los demás chequeos por nivel de Nexo son también permisos `kpi.*`."""

import pytest

from apps.analytics import access
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import make_user

pytestmark = pytest.mark.django_db


def _fresh(user: User) -> User:
    return User.objects.get(pk=user.pk)


def test_superuser_can_always_view_operational_risk():
    admin = make_user("admin")
    admin.is_superuser = True
    admin.save()
    assert access.can(_fresh(admin), access.RIESGO_VER) is True


def test_administrador_de_gestion_humana_has_everything():
    admin = make_user("admin_gh", ADMIN_GH)
    assert set(access.effective_codenames(_fresh(admin))) == set(access.ALL_CODENAMES)


@pytest.mark.parametrize("group_name", ["JEFE_NACIONAL", "COORDINADOR_NACIONAL", "COORDINADOR_ZS"])
def test_allowed_roles_can_view_operational_risk(group_name):
    assert access.can(_fresh(make_user("u", group_name)), access.RIESGO_VER) is True


@pytest.mark.parametrize(
    "group_name",
    [
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
    ],
)
def test_disallowed_roles_cannot_view_operational_risk(group_name):
    # ANALISTA_CC/ANALISTA_SELECCION comparten nivel 2 con COORDINADOR_ZS
    # en ROLE_LEVEL pero NO están en el whitelist de Riesgo Operativo —
    # confirma que esto es un whitelist puntual, no un umbral de nivel.
    assert access.can(_fresh(make_user("u2", group_name)), access.RIESGO_VER) is False


def test_user_without_group_cannot_view_operational_risk():
    assert access.can(_fresh(make_user("nogroup")), access.RIESGO_VER) is False


# --- Lo que en Nexo eran niveles (`can_view_team`, `is_leadership`) ---------


@pytest.mark.parametrize(
    "group_name,equipo,ejecutivo",
    [
        ("JEFE_NACIONAL", True, True),
        ("COORDINADOR_NACIONAL", True, True),
        ("COORDINADOR_ZS", True, False),
        ("ANALISTA_CC", True, False),
        ("ANALISTA_SELECCION", True, False),
        ("ASISTENTE_SELECCION", False, False),
        ("ASISTENTE_GH", False, False),
        ("ASISTENTE_GH_ZS", False, False),
        ("TRABAJO_SOCIAL", False, False),
        ("ASISTENTE_NOMINA", False, False),
    ],
)
def test_permisos_por_rol_como_los_niveles_de_nexo(group_name, equipo, ejecutivo):
    user = _fresh(make_user("rol", group_name))
    assert access.can(user, access.ACCEDER) is True
    assert access.can(user, access.EQUIPO) is equipo
    assert access.can(user, access.EJECUTIVO) is ejecutivo
    assert access.can(user, access.ADMINISTRAR) is False


def test_el_administrador_de_ti_no_tiene_nada_del_kpi():
    """Decisión del usuario (05/11/2026), la misma de `tasks/0003`."""
    ti = _fresh(make_user("ti", "Administrador"))
    for codename in access.ALL_CODENAMES:
        rol_da = ti.groups.filter(
            permissions__codename=codename, permissions__content_type__app_label="permissions"
        ).exists()
        assert rol_da is False, codename


def test_el_superusuario_recibe_todo_el_kpi():
    from django.contrib.auth.models import Group

    rol = Group.objects.filter(name="Superusuario").first()
    if rol is None:
        pytest.skip("Sin rol Superusuario en esta base.")
    codenames = set(rol.permissions.values_list("codename", flat=True))
    assert set(access.ALL_CODENAMES) <= codenames
