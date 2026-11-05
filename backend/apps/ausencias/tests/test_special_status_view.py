"""`/api/v1/ausencias/special-status/`, portado de Nexo
(`test_special_status_view.py`). El superusuario de Nexo es aquí quien tiene
`ausencias.estados_gestionar`; la prueba «grupo ADMINISTRADOR sin
`is_superuser`» se reemplaza por la del rol Administrador (TI), que no lo
tiene."""

from datetime import date, datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.ausencias.models import SpecialStatus

from .conftest import client_for, make_admin, make_user

pytestmark = pytest.mark.django_db

URL = "/api/v1/ausencias/special-status/"


def _valid_body(user_id: int, **overrides) -> dict:
    body = {
        "user_id": user_id,
        "type": "MATERNIDAD",
        "start_date": "2026-01-05",
        "daily_hours": 4,
        "limit_low": 2,
        "limit_base": 4,
        "limit_high": 5,
        "limit_overload": 6,
    }
    body.update(overrides)
    return body


def _status(user, admin, **extra):
    campos = {"type": SpecialStatus.Type.MATERNIDAD, "start_date": date(2026, 1, 1), **extra}
    return SpecialStatus.objects.create(user=user, created_by=admin, **campos)


# --- GET -------------------------------------------------------------------------


def test_get_requires_authentication():
    assert APIClient().get(URL).status_code == 401


def test_get_requires_permission():
    jefe = make_user("jefe", "JEFE_NACIONAL")
    assert client_for(jefe).get(URL).status_code == 403


def test_get_rejects_the_it_administrator_role():
    """Decisión del usuario (05/11/2026): el rol «Administrador» (TI) no ve
    nada de esto."""
    admin_ti = make_user("admin_ti")
    admin_ti.groups.set([Group.objects.get_or_create(name="Administrador")[0]])
    assert client_for(admin_ti).get(URL).status_code == 403


def test_get_filters_by_user_id():
    admin = make_admin()
    target = make_user("analista", "ANALISTA_CC")
    other = make_user("otro", "ANALISTA_CC")
    _status(target, admin)
    _status(other, admin)
    response = client_for(admin).get(f"{URL}?user_id={target.id}")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["user"]["name"] == "Ana"


# --- POST ---------------------------------------------------------------------------


def test_post_requires_permission():
    jefe = make_user("jefe2", "JEFE_NACIONAL")
    target = make_user("analista2", "ANALISTA_CC")
    assert client_for(jefe).post(URL, _valid_body(target.id), format="json").status_code == 403


def test_post_404_for_unknown_user():
    admin = make_admin("admin2")
    assert client_for(admin).post(URL, _valid_body(999999), format="json").status_code == 404


def test_post_400_for_hours_field_out_of_range():
    admin = make_admin("admin3")
    target = make_user("analista3", "ANALISTA_CC")
    response = client_for(admin).post(URL, _valid_body(target.id, daily_hours=30), format="json")
    assert response.status_code == 400


def test_post_400_for_zero_hours():
    admin = make_admin("admin4")
    target = make_user("analista4", "ANALISTA_CC")
    response = client_for(admin).post(URL, _valid_body(target.id, limit_low=0), format="json")
    assert response.status_code == 400


def test_post_400_for_non_monotonic_limits():
    admin = make_admin("admin5")
    target = make_user("analista5", "ANALISTA_CC")
    body = _valid_body(target.id, limit_low=5, limit_base=4, limit_high=5, limit_overload=6)
    assert client_for(admin).post(URL, body, format="json").status_code == 400


def test_post_400_for_end_before_start():
    admin = make_admin("admin6")
    target = make_user("analista6", "ANALISTA_CC")
    body = _valid_body(target.id, start_date="2026-01-10", end_date="2026-01-01")
    assert client_for(admin).post(URL, body, format="json").status_code == 400


def test_post_creates_special_status():
    admin = make_admin("admin7")
    target = make_user("analista7", "ANALISTA_CC")
    response = client_for(admin).post(URL, _valid_body(target.id), format="json")
    assert response.status_code == 201
    assert response.data["dailyHours"] == 4
    assert response.data["isActive"] is True
    assert SpecialStatus.objects.get(user=target).created_by_id == admin.id


def test_post_allows_limit_base_equal_limit_high():
    admin = make_admin("admin8")
    target = make_user("analista8", "ANALISTA_CC")
    body = _valid_body(target.id, limit_low=3, limit_base=5, limit_high=5, limit_overload=6)
    assert client_for(admin).post(URL, body, format="json").status_code == 201


# --- PATCH (finalizar) ---------------------------------------------------------------


def test_patch_requires_permission():
    admin = make_admin("admin9")
    record = _status(make_user("analista9", "ANALISTA_CC"), admin)
    jefe = make_user("jefe3", "JEFE_NACIONAL")
    assert client_for(jefe).patch(f"{URL}{record.id}/").status_code == 403


def test_patch_404_for_missing_record():
    admin = make_admin("admin10")
    assert client_for(admin).patch(f"{URL}999999/").status_code == 404


def test_patch_finalizes_open_ended_status_today():
    admin = make_admin("admin11")
    record = _status(
        make_user("analista10", "ANALISTA_CC"), admin, type=SpecialStatus.Type.LACTANCIA
    )
    with patch(
        "apps.ausencias.services.timezone.now",
        return_value=datetime(2026, 3, 10, 12, 0, tzinfo=dt_timezone.utc),
    ):
        response = client_for(admin).patch(f"{URL}{record.id}/")
    assert response.status_code == 200
    assert response.data["isActive"] is False
    record.refresh_from_db()
    assert record.end_date == date(2026, 3, 10)


def test_patch_never_extends_a_past_end_date():
    admin = make_admin("admin12")
    record = _status(
        make_user("analista11", "ANALISTA_CC"),
        admin,
        type=SpecialStatus.Type.LACTANCIA,
        end_date=date(2026, 1, 15),
    )
    with patch(
        "apps.ausencias.services.timezone.now",
        return_value=datetime(2026, 3, 10, 12, 0, tzinfo=dt_timezone.utc),
    ):
        response = client_for(admin).patch(f"{URL}{record.id}/")
    assert response.status_code == 200
    record.refresh_from_db()
    assert record.end_date == date(2026, 1, 15)


# --- DELETE ----------------------------------------------------------------------------


def test_delete_requires_permission():
    admin = make_admin("admin13")
    record = _status(make_user("analista12", "ANALISTA_CC"), admin)
    jefe = make_user("jefe4", "JEFE_NACIONAL")
    assert client_for(jefe).delete(f"{URL}{record.id}/").status_code == 403


def test_delete_404_for_missing_record():
    admin = make_admin("admin14")
    assert client_for(admin).delete(f"{URL}999999/").status_code == 404


def test_delete_removes_record():
    admin = make_admin("admin15")
    record = _status(make_user("analista13", "ANALISTA_CC"), admin)
    assert client_for(admin).delete(f"{URL}{record.id}/").status_code == 200
    assert not SpecialStatus.objects.filter(pk=record.id).exists()
