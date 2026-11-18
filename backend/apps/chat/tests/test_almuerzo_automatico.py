"""El estado pasa solo a «En almuerzo» en su horario (18/11/2026).

Pedido del usuario: con el horario de almuerzo configurado, el estado debe
cambiar solo dentro de ese horario, como cambia con el calendario en una
reunión. Lo que la persona elige manda.
"""

import datetime

import pytest
from django.utils import timezone

from apps.chat import estados
from apps.chat.models import EstadoChat
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _a_las(hora, minuto=0, dia=datetime.date(2026, 11, 18)):  # miércoles
    return timezone.make_aware(
        datetime.datetime.combine(dia, datetime.time(hora, minuto)),
        timezone.get_current_timezone(),
    )


@pytest.fixture
def estado():
    usuario = User.objects.create_user(
        username="ana", email="ana@grupolaar.com", password="Sup3r-Secr3t!"
    )
    return EstadoChat.objects.create(
        usuario=usuario, almuerzo_inicio=datetime.time(13, 0), almuerzo_minutos=45
    )


def test_en_su_horario_esta_en_almuerzo_y_vuelve_sola(estado):
    assert estados.vigente(estado, _a_las(12, 59)) is None
    dentro = estados.vigente(estado, _a_las(13, 10))
    assert dentro["clave"] == EstadoChat.Estado.ALMUERZO
    assert dentro["detalle"] == "En almuerzo hasta las 13:45"
    assert estados.vigente(estado, _a_las(13, 45)) is None


def test_el_fin_de_semana_no(estado):
    sabado = datetime.date(2026, 11, 21)
    assert estados.vigente(estado, _a_las(13, 10, sabado)) is None


def test_sin_horario_no(estado):
    estado.almuerzo_inicio = None
    assert estados.vigente(estado, _a_las(13, 10)) is None


def test_otro_estado_elegido_manda(estado):
    estado.estado = EstadoChat.Estado.REUNION
    estado.hasta = _a_las(14, 0)
    assert estados.vigente(estado, _a_las(13, 10))["clave"] == EstadoChat.Estado.REUNION


def test_si_vuelve_a_disponible_durante_el_almuerzo_ese_dia_no_vuelve(estado, monkeypatch):
    monkeypatch.setattr(estados.timezone, "now", lambda: _a_las(13, 10))
    estados.guardar(estado.usuario, {"estado": "disponible"})
    estado.refresh_from_db()
    assert estado.almuerzo_omitido == datetime.date(2026, 11, 18)
    assert estados.vigente(estado, _a_las(13, 20)) is None
    # Al día siguiente, otra vez.
    jueves = datetime.date(2026, 11, 19)
    assert estados.vigente(estado, _a_las(13, 20, jueves))["clave"] == EstadoChat.Estado.ALMUERZO


def test_cambiar_el_horario_vuelve_a_contar(estado, monkeypatch):
    monkeypatch.setattr(estados.timezone, "now", lambda: _a_las(13, 10))
    estados.guardar(estado.usuario, {"estado": "disponible"})
    estados.guardar(estado.usuario, {"almuerzo_inicio": datetime.time(13, 15)})
    estado.refresh_from_db()
    assert estado.almuerzo_omitido is None
    assert estados.vigente(estado, _a_las(13, 20))["clave"] == EstadoChat.Estado.ALMUERZO
