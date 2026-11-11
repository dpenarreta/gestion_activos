"""Aprobaciones de la Mesa de ayuda con el aprobador ausente (11/11/2026,
US-001).

Lo que se protege: el visto bueno de un responsable de área ausente pasa a su
reemplazo, que recibe el correo de siempre, y el historial del ticket lo dice
(CA-4); lo que ya tenía pendiente pasa una sola vez (CA-5); sin reemplazo se
queda con él y el detalle dice que está ausente (CA-6, CA-7).
"""

import datetime

from django.core import mail
from django.utils import timezone

from apps.chat.models import EstadoChat
from apps.empresas.contexto import usando_empresa
from apps.organizacion import ausencia
from apps.organizacion.models import DatosDeContacto
from apps.soporte.models import MovimientoTicket
from apps.soporte.tests.test_flujo_itil import _caso_con_aprobacion, _jefe_de
from apps.soporte.tests.test_soporte import TICKETS, _crear, _equipo, _ticket, _usuario


def _fuera(usuario):
    EstadoChat.objects.update_or_create(
        usuario=usuario,
        defaults={
            "estado": EstadoChat.Estado.FUERA_OFICINA,
            "hasta": timezone.now() + datetime.timedelta(days=3),
        },
    )


def _rosa_y_tito(mesa, con_reemplazo=True):
    rosa = _usuario("rosa", empresa=mesa["empresa"])
    tito = _usuario("tito", empresa=mesa["empresa"])
    _jefe_de(mesa["area"], rosa, mesa["empresa"])
    if con_reemplazo:
        with usando_empresa(mesa["empresa"]):
            DatosDeContacto.objects.create(usuario=rosa, reemplazo_modo="persona", reemplazo=tito)
    return rosa, tito


def _historial(ticket):
    with usando_empresa(ticket.empresa):
        return list(
            MovimientoTicket.objects.filter(ticket=ticket).values_list("descripcion", flat=True)
        )


def test_el_visto_bueno_pasa_al_reemplazo_de_la_jefa_ausente(mesa):
    rosa, tito = _rosa_y_tito(mesa)
    _fuera(rosa)
    mail.outbox.clear()
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    with usando_empresa(mesa["empresa"]):
        aprobacion = ticket.aprobaciones.get()
    assert aprobacion.aprobador == tito
    assert "Escalada a Tito por ausencia de Rosa (Jefe de área (Cobranzas))" in _historial(ticket)
    # El correo de siempre, al reemplazo.
    destinatarios = {d for m in mail.outbox for d in (*m.to, *m.bcc)}
    assert "tito@x.com" in destinatarios and "rosa@x.com" not in destinatarios
    # Tito lo ve en sus aprobaciones y decide.
    cliente = _equipo(tito)
    assert [p["id"] for p in cliente.get("/api/v1/soporte/aprobaciones/").json()] == [aprobacion.id]


def test_lo_pendiente_pasa_una_sola_vez(mesa):
    rosa, tito = _rosa_y_tito(mesa)
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    _fuera(rosa)
    mail.outbox.clear()
    assert ausencia.reasignar_pendientes(rosa) == 1
    assert ausencia.reasignar_pendientes(rosa) == 0
    with usando_empresa(mesa["empresa"]):
        assert ticket.aprobaciones.get().aprobador == tito
    escaladas = [d for d in _historial(ticket) if d.startswith("Escalada a")]
    assert escaladas == ["Escalada a Tito por ausencia de Rosa (Jefe de área (Cobranzas))"]
    assert any("tito@x.com" in (*m.to, *m.bcc) for m in mail.outbox)


def test_sin_reemplazo_se_queda_y_el_detalle_dice_que_esta_ausente(mesa):
    rosa, _ = _rosa_y_tito(mesa, con_reemplazo=False)
    _fuera(rosa)
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    with usando_empresa(mesa["empresa"]):
        assert ticket.aprobaciones.get().aprobador == rosa
    detalle = _equipo(mesa["supervisor"]).get(f"{TICKETS}{ticket.id}/").json()
    [aprobacion] = detalle["aprobaciones"]
    assert aprobacion["aprobador"] == "Rosa"
    assert aprobacion["aprobador_ausencia"]["clave"] == "fuera_oficina"
    assert aprobacion["aprobador_ausencia"]["reemplazo"] is None


# --- Ronda 1 de correcciones (QA, 11/11/2026) ----------------------------------------------


def test_una_decision_con_datos_viejos_no_pisa_la_reasignacion(mesa):
    import pytest
    from django.core.exceptions import PermissionDenied

    from apps.soporte import services
    from apps.soporte.models import AprobacionTicket

    rosa, tito = _rosa_y_tito(mesa)
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    with usando_empresa(mesa["empresa"]):
        vieja = ticket.aprobaciones.get()  # cargada antes de la reasignación
        _fuera(rosa)
        assert ausencia.reasignar_pendientes(rosa) == 1
        # Rosa decide con la copia de antes: ya no le corresponde.
        with pytest.raises(PermissionDenied):
            services.decidir_aprobacion(vieja, rosa, aprobar=True)
        # Tito decide con una copia vieja (aprobador = Rosa): vale y no
        # devuelve el visto bueno a Rosa.
        vieja = AprobacionTicket.objects.get(pk=vieja.pk)
        vieja.aprobador_id = rosa.pk
        services.decidir_aprobacion(vieja, tito, aprobar=True)
        fila = AprobacionTicket.objects.get(pk=vieja.pk)
    assert fila.estado == "aprobada"
    assert fila.aprobador_id == tito.pk and fila.decidido_por_id == tito.pk


def test_dos_vistos_buenos_no_se_juntan_en_una_persona(mesa):
    from apps.organizacion.models import Departamento

    rosa, tito = _rosa_y_tito(mesa)
    with usando_empresa(mesa["empresa"]):
        sistemas = Departamento.objects.create(nombre="Sistemas", codigo="SIS")
    _jefe_de(sistemas, tito, mesa["empresa"])
    caso = _caso_con_aprobacion(mesa)
    caso.aprueban.add(sistemas)
    ticket = _ticket(_crear(mesa, caso=caso.id)["id"], mesa)
    _fuera(rosa)
    # El reemplazo de Rosa es Tito, que ya tiene el otro visto bueno: se queda.
    assert ausencia.reasignar_pendientes(rosa) == 0
    with usando_empresa(mesa["empresa"]):
        aprobadores = sorted(a.aprobador.username for a in ticket.aprobaciones.all())
    assert aprobadores == ["rosa", "tito"]


def test_al_crear_tampoco_se_juntan(mesa):
    from apps.organizacion.models import Departamento

    rosa, tito = _rosa_y_tito(mesa)
    with usando_empresa(mesa["empresa"]):
        sistemas = Departamento.objects.create(nombre="Sistemas", codigo="SIS")
    _jefe_de(sistemas, tito, mesa["empresa"])
    caso = _caso_con_aprobacion(mesa)
    caso.aprueban.add(sistemas)
    _fuera(rosa)
    ticket = _ticket(_crear(mesa, caso=caso.id)["id"], mesa)
    with usando_empresa(mesa["empresa"]):
        aprobadores = sorted(a.aprobador.username for a in ticket.aprobaciones.all())
    assert aprobadores == ["rosa", "tito"]


def test_no_se_reasigna_un_ticket_que_ya_no_espera_aprobacion(mesa):
    from apps.soporte import services
    from apps.soporte.models import Ticket

    rosa, tito = _rosa_y_tito(mesa)
    ticket = _ticket(_crear(mesa, caso=_caso_con_aprobacion(mesa).id)["id"], mesa)
    _fuera(rosa)
    with usando_empresa(mesa["empresa"]):
        Ticket.objects.filter(pk=ticket.pk).update(estado="cerrado")
        assert services.reasignar_por_ausencia(rosa, base=tito) == 0
        assert ticket.aprobaciones.get().aprobador == rosa
