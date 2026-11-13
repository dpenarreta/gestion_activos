"""Quien pidió el ticket recibe en la campana (y en la app) cada cambio de
estado (13/11/2026: «En curso» no avisaba nada y «Atendido» solo por correo)."""

import pytest

from apps.empresas.contexto import usando_empresa
from apps.notificaciones.models import Notificacion
from apps.soporte.models import ConfiguracionMesa
from apps.soporte.tests.test_soporte import (
    SEGUIMIENTO,
    TICKETS,
    _carla,
    _crear,
    _equipo,
    _quien_pide,
    _siempre,
    _ticket,
)

pytestmark = pytest.mark.django_db

TIPO = "soporte.estado_del_ticket"


def _avisos(usuario):
    return list(
        Notificacion.objects.todas()
        .filter(usuario=usuario, tipo=TIPO)
        .order_by("id")
        .values_list("titulo", "resumen", "enlace")
    )


def _cambiar(mesa, ticket, estado, **extra):
    respuesta = _equipo(mesa["jorge"].usuario).post(
        f"{TICKETS}{ticket.id}/cambiar-estado/", {"estado": estado, **extra}, format="json"
    )
    assert respuesta.status_code == 200, respuesta.data
    ticket.refresh_from_db()


def test_cada_cambio_de_estado_llega_a_quien_pidio(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)  # se reparte: queda asignado
    carla = _carla(mesa)
    enlace = f"/admin/ayuda/tickets/{ticket.id}"

    _cambiar(mesa, ticket, "en_curso")
    _cambiar(mesa, ticket, "esperando_usuario", nota="¿Qué modelo de impresora es?")
    _quien_pide(mesa).post(f"{SEGUIMIENTO}{ticket.id}/", {"texto": "Una HP"}, format="json")
    _cambiar(mesa, ticket, "atendido")

    avisos = _avisos(carla)
    titulos = [t for t, _, _ in avisos]
    assert titulos == [
        f"{ticket.numero} · Asignado",
        f"{ticket.numero} · En curso",
        f"{ticket.numero} · Esperando al usuario",
        f"{ticket.numero} · Atendido",
    ]
    # Su propia respuesta (que lo vuelve a «En curso») no le avisa a ella.
    assert all(e == enlace for _, _, e in avisos)
    assert "tomó su ticket" in avisos[0][1]
    assert "trabajando en su ticket" in avisos[1][1]
    assert "Confirme que quedó resuelto" in avisos[3][1]


def test_confirmar_la_solucion_no_le_avisa_a_quien_confirma(mesa):
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _cambiar(mesa, ticket, "atendido")
    antes = len(_avisos(_carla(mesa)))
    _quien_pide(mesa).post(f"{SEGUIMIENTO}{ticket.id}/", {"confirmar": True}, format="json")
    ticket.refresh_from_db()
    assert ticket.estado == "cerrado"
    assert len(_avisos(_carla(mesa))) == antes


def test_el_titulo_usa_el_nombre_de_estado_de_la_empresa(mesa):
    with usando_empresa(mesa["empresa"]):
        ConfiguracionMesa.objects.create(etiquetas={"estados": {"en_curso": "En atención"}})
    _siempre(mesa["jorge"])
    ticket = _ticket(_crear(mesa)["id"], mesa)
    _cambiar(mesa, ticket, "en_curso")
    assert _avisos(_carla(mesa))[-1][0] == f"{ticket.numero} · En atención"
