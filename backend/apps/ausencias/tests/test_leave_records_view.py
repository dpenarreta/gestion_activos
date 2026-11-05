"""`/api/v1/ausencias/leave-records/`, portado de Nexo
(`test_leave_records_view.py`, que probaba `/api/v1/settings/leave-records/`).

Adaptaciones: el «superusuario» de Nexo es quien tiene los permisos del
catálogo (el Administrador de Gestión Humana); quien no los tiene ya no
recibe 403 al listar sino solo lo suyo; los feriados son los del calendario
institucional (`EventoCalendario`), no la tabla `Holiday`. La prueba de Nexo
«grupo ADMINISTRADOR sin `is_superuser`» no aplica: aquí no hay grupo que
valga por sí solo, valen los permisos."""

from datetime import date

import pytest
from rest_framework.test import APIClient

from apps.ausencias.models import LeaveRecord
from apps.organizacion.models import EventoCalendario

from .conftest import client_for, make_admin, make_user

pytestmark = pytest.mark.django_db

URL = "/api/v1/ausencias/leave-records/"


def _record(user, admin, **extra):
    campos = {
        "type": LeaveRecord.Type.MEDICO,
        "date": date(2026, 1, 5),
        "is_full_day": True,
        **extra,
    }
    return LeaveRecord.objects.create(user=user, created_by=admin, **campos)


# --- GET -------------------------------------------------------------------------


def test_get_requires_authentication():
    assert APIClient().get(URL).status_code == 401


def test_get_without_permissions_returns_only_own():
    admin = make_admin()
    jefe = make_user("jefe", "JEFE_NACIONAL")
    otro = make_user("otro", "ANALISTA_CC")
    _record(otro, admin)
    propio = _record(jefe, admin, type=LeaveRecord.Type.PERSONAL)
    response = client_for(jefe).get(URL)
    assert response.status_code == 200
    assert [r["id"] for r in response.data] == [propio.id]
    # Lo suyo, con detalle.
    assert response.data[0]["type"] == "PERSONAL"


def test_get_filters_by_user_id():
    admin = make_admin()
    target = make_user("analista", "ANALISTA_CC")
    other = make_user("otro", "ANALISTA_CC")
    _record(target, admin)
    _record(other, admin)

    response = client_for(admin).get(f"{URL}?user_id={target.id}")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["user"]["name"] == "Ana"


def test_get_filters_by_month():
    admin = make_admin("admin2")
    target = make_user("analista2", "ANALISTA_CC")
    _record(target, admin)
    _record(target, admin, date=date(2026, 2, 5))

    response = client_for(admin).get(f"{URL}?month=2026-01")
    assert len(response.data) == 1
    assert response.data[0]["date"] == "2026-01-05"


# --- POST ---------------------------------------------------------------------------


def _body(user_id, **overrides):
    body = {
        "user_id": user_id,
        "type": "MEDICO",
        "start_date": "2026-01-05",
        "end_date": "2026-01-05",
        "is_full_day": True,
    }
    body.update(overrides)
    return body


def test_post_requires_permission():
    jefe = make_user("jefe2", "JEFE_NACIONAL")
    target = make_user("analista3", "ANALISTA_CC")
    response = client_for(jefe).post(URL, _body(target.id), format="json")
    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"


def test_post_400_for_end_before_start():
    admin = make_admin("admin3")
    target = make_user("analista4", "ANALISTA_CC")
    response = client_for(admin).post(URL, _body(target.id, end_date="2026-01-01"), format="json")
    assert response.status_code == 400


def test_post_400_for_vacaciones_not_full_day():
    admin = make_admin("admin4")
    target = make_user("analista5", "ANALISTA_CC")
    body = _body(target.id, type="VACACIONES", is_full_day=False, duration_minutes=60)
    response = client_for(admin).post(URL, body, format="json")
    assert response.status_code == 400


def test_post_400_for_missing_duration_when_not_full_day():
    admin = make_admin("admin5")
    target = make_user("analista6", "ANALISTA_CC")
    response = client_for(admin).post(URL, _body(target.id, is_full_day=False), format="json")
    assert response.status_code == 400


def test_post_404_for_unknown_user():
    admin = make_admin("admin6")
    response = client_for(admin).post(URL, _body(999999), format="json")
    assert response.status_code == 404


def test_post_400_when_range_has_no_business_days():
    admin = make_admin("admin7")
    target = make_user("analista7", "ANALISTA_CC")
    # 2026-01-10/11 son sábado y domingo.
    body = _body(target.id, start_date="2026-01-10", end_date="2026-01-11")
    response = client_for(admin).post(URL, body, format="json")
    assert response.status_code == 400


def test_post_excludes_holidays_from_business_days():
    admin = make_admin("admin8")
    target = make_user("analista8", "ANALISTA_CC")
    EventoCalendario.objects.create(
        titulo="Feriado", tipo=EventoCalendario.Tipo.FERIADO, fecha=date(2026, 1, 6)
    )
    # Lunes 5 a viernes 9: 5 laborables menos el feriado del martes 6 = 4.
    body = _body(target.id, start_date="2026-01-05", end_date="2026-01-09")
    response = client_for(admin).post(URL, body, format="json")
    assert response.status_code == 201
    assert response.data["businessDaysCount"] == 4
    assert "2026-01-06" not in {r["date"] for r in response.data["records"]}


def test_post_creates_one_record_per_business_day_with_created_by():
    admin = make_admin("admin9")
    target = make_user("analista9", "ANALISTA_CC")
    body = _body(
        target.id,
        type="PERSONAL",
        start_date="2026-01-05",
        end_date="2026-01-09",
        is_full_day=False,
        duration_minutes=90,
        observation="  Trámite en el registro civil  ",
    )
    response = client_for(admin).post(URL, body, format="json")
    assert response.status_code == 201
    assert response.data["businessDaysCount"] == 5
    records = LeaveRecord.objects.filter(user=target)
    assert records.count() == 5
    assert all(r.duration_minutes == 90 for r in records)
    assert all(r.observation == "Trámite en el registro civil" for r in records)
    assert all(r.created_by_id == admin.id for r in records)


def test_post_400_for_range_longer_than_a_year():
    admin = make_admin("admin13")
    target = make_user("analista12", "ANALISTA_CC")
    body = _body(target.id, type="VACACIONES", start_date="2026-01-05", end_date="2027-02-05")
    response = client_for(admin).post(URL, body, format="json")
    assert response.status_code == 400


# --- DELETE ------------------------------------------------------------------------------


def test_delete_requires_permission():
    admin = make_admin("admin10")
    target = make_user("analista10", "ANALISTA_CC")
    record = _record(target, admin)
    jefe = make_user("jefe3", "JEFE_NACIONAL")
    response = client_for(jefe).delete(f"{URL}{record.id}/")
    # No la ve (no es de su equipo): como si no existiera.
    assert response.status_code == 404


def test_delete_404_for_missing_record():
    admin = make_admin("admin11")
    assert client_for(admin).delete(f"{URL}999999/").status_code == 404


def test_delete_removes_record():
    admin = make_admin("admin12")
    target = make_user("analista11", "ANALISTA_CC")
    record = _record(target, admin)
    response = client_for(admin).delete(f"{URL}{record.id}/")
    assert response.status_code == 200
    assert not LeaveRecord.objects.filter(pk=record.id).exists()
