"""Las consultas del KPI sobre permisos y estados especiales, portado de Nexo
(`apps/configuration/tests/test_leaves_special_status.py`), más las de equipo
y el enmascarado que usará el KPI."""

from datetime import date

import pytest

from apps.ausencias.models import LeaveRecord, SpecialStatus
from apps.ausencias.services import (
    get_leave_minutes_by_day,
    get_special_status_day_map,
    get_team_leave_minutes_by_day,
    get_team_special_status_day_map,
    leave_hours_for_day,
    redact_leave_day,
    redact_leave_totals,
    redact_special_status_day,
    total_leave_minutes,
)

from .conftest import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return make_user("colaborador")


@pytest.fixture
def admin():
    return make_user("admin")


# --- LeaveRecord ------------------------------------------------------------


def test_full_day_leave_discounts_entire_base(user, admin):
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )
    day_map = get_leave_minutes_by_day(user, date(2026, 1, 5), date(2026, 1, 5))
    assert leave_hours_for_day(day_map.get(date(2026, 1, 5)), hours_per_day=6.5) == 6.5


def test_partial_leave_capped_at_hours_per_day(user, admin):
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.PERSONAL,
        date=date(2026, 1, 5),
        is_full_day=False,
        duration_minutes=600,
        created_by=admin,
    )
    day_map = get_leave_minutes_by_day(user, date(2026, 1, 5), date(2026, 1, 5))
    assert leave_hours_for_day(day_map.get(date(2026, 1, 5)), hours_per_day=6.5) == 6.5


def test_partial_leave_below_hours_per_day(user, admin):
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=False,
        duration_minutes=120,
        created_by=admin,
    )
    day_map = get_leave_minutes_by_day(user, date(2026, 1, 5), date(2026, 1, 5))
    assert leave_hours_for_day(day_map.get(date(2026, 1, 5)), hours_per_day=6.5) == 2.0


def test_day_without_leave_returns_zero_hours():
    assert leave_hours_for_day(None, hours_per_day=6.5) == 0


def test_total_leave_minutes_by_type_over_range(user, admin):
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=False,
        duration_minutes=90,
        created_by=admin,
    )
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.VACACIONES,
        date=date(2026, 1, 6),
        is_full_day=True,
        created_by=admin,
    )
    day_map = get_leave_minutes_by_day(user, date(2026, 1, 5), date(2026, 1, 6))
    totals = total_leave_minutes(day_map, date(2026, 1, 5), date(2026, 1, 6), hours_per_day=6.5)
    assert totals == {"medico_minutes": 90, "personal_minutes": 0, "vacaciones_minutes": 390}


def test_team_leave_map_in_one_query(user, admin, django_assert_num_queries):
    otro = make_user("otro")
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.PERSONAL,
        date=date(2026, 1, 5),
        is_full_day=True,
        created_by=admin,
    )
    with django_assert_num_queries(1):
        team = get_team_leave_minutes_by_day([user, otro], date(2026, 1, 1), date(2026, 1, 31))
    assert set(team) == {user.id}
    assert team[user.id][date(2026, 1, 5)]["personal_full_day"] is True


def test_redaction_merges_every_type_into_ausencia(user, admin):
    """Quien no es el titular ni ve lo médico: todo es «ausencia» y las horas
    que descuenta no cambian."""
    LeaveRecord.objects.create(
        user=user,
        type=LeaveRecord.Type.MEDICO,
        date=date(2026, 1, 5),
        is_full_day=False,
        duration_minutes=90,
        created_by=admin,
    )
    day_map = get_leave_minutes_by_day(user, date(2026, 1, 5), date(2026, 1, 5))
    info = day_map[date(2026, 1, 5)]
    redacted = redact_leave_day(info)
    assert redacted["medico_minutes"] == 0
    assert redacted["personal_minutes"] == 90
    assert leave_hours_for_day(redacted, 6.5) == leave_hours_for_day(info, 6.5)

    totals = total_leave_minutes(day_map, date(2026, 1, 5), date(2026, 1, 5), 6.5)
    assert redact_leave_totals(totals) == {
        "medico_minutes": 0,
        "personal_minutes": 0,
        "vacaciones_minutes": 0,
        "ausencia_minutes": 90,
    }


# --- SpecialStatus -------------------------------------------------------------


def test_special_status_day_map_clamped_to_range(user, admin):
    SpecialStatus.objects.create(
        user=user,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 31),
        created_by=admin,
    )
    day_map = get_special_status_day_map(user, date(2026, 1, 5), date(2026, 1, 7))
    assert set(day_map.keys()) == {date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 7)}
    assert day_map[date(2026, 1, 5)]["type"] == "MATERNIDAD"


def test_special_status_without_end_date_extends_to_range_end(user, admin):
    SpecialStatus.objects.create(
        user=user,
        type=SpecialStatus.Type.LACTANCIA,
        start_date=date(2026, 1, 1),
        end_date=None,
        created_by=admin,
    )
    day_map = get_special_status_day_map(user, date(2026, 1, 10), date(2026, 1, 12))
    assert set(day_map.keys()) == {date(2026, 1, 10), date(2026, 1, 11), date(2026, 1, 12)}


def test_no_special_status_returns_empty_map(user):
    assert get_special_status_day_map(user, date(2026, 1, 1), date(2026, 1, 31)) == {}


def test_special_status_uses_configured_values_not_defaults(user, admin):
    SpecialStatus.objects.create(
        user=user,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 10),
        daily_hours=4,
        limit_low=2,
        limit_base=4,
        limit_high=5,
        limit_overload=6,
        created_by=admin,
    )
    day_map = get_special_status_day_map(user, date(2026, 1, 5), date(2026, 1, 5))
    assert day_map[date(2026, 1, 5)] == {
        "type": "MATERNIDAD",
        "daily_hours": 4,
        "limit_low": 2,
        "limit_base": 4,
        "limit_high": 5,
        "limit_overload": 6,
    }
    assert redact_special_status_day(day_map[date(2026, 1, 5)])["type"] is None


def test_team_special_status_only_includes_users_with_overlap(user, admin):
    other = make_user("otro")
    SpecialStatus.objects.create(
        user=user,
        type=SpecialStatus.Type.MATERNIDAD,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 10),
        created_by=admin,
    )
    team_map = get_team_special_status_day_map([user, other], date(2026, 1, 1), date(2026, 1, 31))
    assert set(team_map.keys()) == {user.id}


def test_team_special_status_with_no_users_returns_empty():
    assert get_team_special_status_day_map([], date(2026, 1, 1), date(2026, 1, 31)) == {}
