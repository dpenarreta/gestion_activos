"""Cobertura HTTP de `GET /api/v1/analytics/kpis/executive/` — Fase 21 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/kpis/executive/route.ts`. Compone 100% sobre motor ya
cubierto por sus propios tests (`test_performance_score.py`/
`test_operational_risk.py`/`test_workload_carga_tiempo.py`/etc.) — se
prueba con datos reales para validar el ensamblado HTTP/auth/
visibilidad y la forma de la respuesta, no cada fórmula de negocio ya
verificada por separado."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.tasks.models import Task
from apps.users.models import User

from .conftest import client_for as _client_for
from .conftest import freeze_now, organigrama

pytestmark = pytest.mark.django_db

#: Reloj congelado (en Nexo las fechas eran relativas al reloj real y la
#: prueba caducó al cambiar de mes).
NOW = datetime(2026, 8, 20, 15, 0, tzinfo=dt_timezone.utc)


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    freeze_now(monkeypatch, NOW)


def _first_of_current_month() -> datetime:
    """Primer instante del mes en curso, en UTC."""
    return NOW.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(
        username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!"
    )
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(
        username="analista",
        email="analista@example.com",
        password="Sup3r-Secr3t!",
        first_name="Ana",
    )
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def equipo(coordinador_nacional, analista):
    """En Nexo la Coordinación Nacional veía a los analistas por su rol; aquí
    por el organigrama."""
    organigrama(coordinador_nacional, analista)


@pytest.fixture
def coordinador_zs():
    user = User.objects.create_user(
        username="coord_zs", email="coord_zs@example.com", password="Sup3r-Secr3t!"
    )
    user.groups.set([Group.objects.get(name="COORDINADOR_ZS")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    payload = dict(
        title="Tarea",
        priority=Task.Priority.MEDIA,
        frequency=Task.Frequency.PUNTUAL,
        type=Task.Type.FIJA,
        start_date=_first_of_current_month(),
        end_date=NOW,
        estimated_hours=5,
        assigned_to=assigned_to,
        created_by=created_by,
        status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


def test_requires_authentication():
    response = APIClient().get("/api/v1/analytics/kpis/executive/")
    assert response.status_code == 401


def test_requires_leadership_level(coordinador_zs):
    """`is_leadership` exige `ROLE_LEVEL>=3` — Coordinador ZS (nivel 2)
    no accede, aunque sí pase `can_view_team` (nivel>=2)."""
    response = _client_for(coordinador_zs).get("/api/v1/analytics/kpis/executive/")
    assert response.status_code == 403


def test_empty_response_shape_without_real_subordinates(coordinador_nacional):
    """Sin equipo en el organigrama no hay a quién resumir."""
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/kpis/executive/")
    assert response.status_code == 200
    assert response.data["month"] == ""
    assert response.data["overview"] == {
        "avg_cumplimiento": 0,
        "avg_cumplimiento_color": "red",
        "sobrecarga_count": 0,
        "subutilizacion_count": 0,
        "total_horas": 0,
        "total_consultas": 0,
    }
    assert response.data["trend"] == []
    assert response.data["ranking"] == []
    assert response.data["ceo"]["estado"] == "green"
    assert response.data["ceo"]["estado_label"] == "Sin datos"


def test_200_includes_subordinate_snapshot_and_ceo_block(coordinador_nacional, analista, equipo):
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA
    )

    response = _client_for(coordinador_nacional).get("/api/v1/analytics/kpis/executive/")
    assert response.status_code == 200

    entry = next(m for m in response.data["ranking"] if m["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["role"] == "ANALISTA_CC"
    assert entry["total_tasks"] == 1
    assert entry["completed"] == 1
    assert "score_trend" in entry

    workload_entry = next(w for w in response.data["workload"] if w["id"] == analista.id)
    assert "real_hours" in workload_entry and "base_hours" in workload_entry

    ceo = response.data["ceo"]
    for key in ("estado", "estado_label", "cambios", "atender", "performance", "operational_risk"):
        assert key in ceo
    assert set(ceo["performance"]) == {"avg", "classification", "color"}
    assert set(ceo["operational_risk"]) == {"avg", "classification", "color"}


def test_pending_ideas_is_empty_until_mejora_continua_is_ported(
    coordinador_nacional, analista, equipo
):
    """En Nexo: las ideas PROPUESTA/EN_REVISION. Mejora Continua
    (`ImprovementIdea`) no está portado a la intranet: la lista va vacía y
    con la misma forma (pendiente)."""
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA
    )
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/kpis/executive/")
    assert response.status_code == 200
    assert response.data["alerts"]["pending_ideas"] == []


def test_trend_and_ranking_reflect_month_over_month_change(coordinador_nacional, analista, equipo):
    # Mes en curso: una tarea completada — cumplimiento 100%. Mes anterior
    # (dentro de la ventana de 6 meses del snapshot): una pendiente — 0%.
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA
    )
    _create_task(
        assigned_to=analista,
        created_by=coordinador_nacional,
        status=Task.Status.PENDIENTE,
        end_date=_first_of_current_month() - timedelta(days=1),
    )

    response = _client_for(coordinador_nacional).get("/api/v1/analytics/kpis/executive/")
    assert response.status_code == 200
    assert response.data["overview"]["avg_cumplimiento"] == 100
    assert response.data["month"] != ""

    # El mes en curso es el último punto de la tendencia, y el anterior
    # entra con su propio valor — que es lo que el nombre del test promete.
    trend = response.data["trend"]
    assert [point["avg_cumplimiento"] for point in trend[-2:]] == [0, 100]
    assert trend[-1]["month"] == response.data["month"]


def test_excluye_al_liderazgo_aunque_este_en_su_organigrama(coordinador_nacional, analista):
    """Regla de Nexo (`isExecutorRole`): quien tiene un rol de nivel >= 4 no
    es sujeto de los KPI de ejecución, aunque dependa de quien consulta."""
    jefe = User.objects.create_user(
        username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!"
    )
    jefe.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    organigrama(coordinador_nacional, analista, jefe)
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA
    )
    response = _client_for(coordinador_nacional).get("/api/v1/analytics/kpis/executive/")
    ids = {m["id"] for m in response.data["ranking"]}
    assert analista.id in ids
    assert jefe.id not in ids
