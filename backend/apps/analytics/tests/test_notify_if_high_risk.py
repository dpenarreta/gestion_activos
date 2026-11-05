"""Cobertura de `apps.analytics.services.notify_if_high_risk`, réplica de
`notifyIfHighRisk` de Nexo.

Adaptado a la intranet: el aviso va al jefe inmediato según el organigrama
(en Nexo, los roles de `RoleNotificationTarget`), a la campana
(`Notificacion`, el mensaje en `resumen`), y la marca de «ya avisado este
mes» queda en `AnalyticsAuditLog` (en Nexo, `Notification.dedup_key`)."""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Group

from apps.analytics.models import AnalyticsAuditLog
from apps.analytics.services import notify_if_high_risk
from apps.notificaciones.models import Notificacion
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import organigrama

pytestmark = pytest.mark.django_db


def _notifications():
    return Notificacion.objects.filter(tipo="kpi.riesgo_operativo")


NOW = datetime(2026, 8, 20, 10, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def analista():
    # En Nexo ANALISTA_CC notificaba a COORDINADOR_NACIONAL por su rol; aquí
    # el aviso va a quien ocupa el cargo del que depende (fixture `equipo`).
    user = User.objects.create_user(
        username="analista",
        email="analista@example.com",
        password="Sup3r-Secr3t!",
        first_name="Ana",
    )
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(
        username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!"
    )
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture(autouse=True)
def equipo(request):
    if {"analista", "coordinador_nacional"} <= set(request.fixturenames):
        organigrama(
            request.getfixturevalue("coordinador_nacional"), request.getfixturevalue("analista")
        )


@pytest.mark.parametrize("classification", ["Bajo", "Medio"])
def test_no_notification_below_alto(analista, coordinador_nacional, classification):
    notify_if_high_risk(
        user=analista, risk={"classification": classification, "score": 50}, now=NOW
    )
    assert not _notifications().exists()


@pytest.mark.parametrize("classification", ["Alto", "Crítico"])
def test_notifies_targets_when_alto_or_critico(analista, coordinador_nacional, classification):
    notify_if_high_risk(
        user=analista, risk={"classification": classification, "score": 85}, now=NOW
    )
    notification = _notifications().get()
    assert notification.usuario_id == coordinador_nacional.id
    assert "Ana" in notification.resumen
    assert classification.lower() in notification.resumen
    marca = AnalyticsAuditLog.objects.get(user=analista, kind="risk_notification")
    assert marca.period == "2026-08"


def test_deduplicates_within_same_month(analista, coordinador_nacional):
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=NOW)
    notify_if_high_risk(user=analista, risk={"classification": "Crítico", "score": 95}, now=NOW)
    assert _notifications().count() == 1


def test_notifies_again_in_a_different_month(analista, coordinador_nacional):
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=NOW)
    next_month = datetime(2026, 9, 1, tzinfo=dt_timezone.utc)
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=next_month)
    assert _notifications().count() == 2


def test_no_notification_when_role_has_no_targets():
    """Sin jefe en el organigrama no hay a quién avisar."""
    admin = User.objects.create_user(
        username="admin_role", email="admin_role@example.com", password="Sup3r-Secr3t!"
    )
    admin.groups.set([Group.objects.get(name=ADMIN_GH)])
    notify_if_high_risk(user=admin, risk={"classification": "Crítico", "score": 99}, now=NOW)
    assert not _notifications().exists()


def test_no_notification_without_group():
    """Sin cargo en el organigrama no hay a quién avisar."""
    user = User.objects.create_user(
        username="nogroup", email="nogroup@example.com", password="Sup3r-Secr3t!"
    )
    notify_if_high_risk(user=user, risk={"classification": "Alto", "score": 85}, now=NOW)
    assert not _notifications().exists()


def test_la_marca_sobrevive_a_la_purga_de_la_campana(analista, coordinador_nacional):
    """Aunque la campana borre el aviso, no se repite en el mismo mes."""
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=NOW)
    _notifications().delete()
    notify_if_high_risk(user=analista, risk={"classification": "Alto", "score": 85}, now=NOW)
    assert not _notifications().exists()
