"""La API de Reuniones (`/api/v1/reuniones/`): las reglas de Nexo y lo que
cambia sin Zoom."""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.notificaciones.models import Notificacion
from apps.reuniones.models import Meeting, MeetingInvitee
from apps.reuniones.services import EN_HORARIO, PASADA, PROXIMA, momento

from .conftest import BASE, ENLACE, client_for, manana, reunion_de

pytestmark = pytest.mark.django_db


def _nueva(cliente, **extra):
    datos = {
        "title": "Revisión de vacaciones de diciembre",
        "description": "Agenda: cronograma y reemplazos en Durán",
        "meeting_date": manana().isoformat(),
        "duration": 40,
        "join_url": ENLACE,
        "join_password": "Ñandú-2026",
        **extra,
    }
    return cliente.post(f"{BASE}/meetings/", datos, format="json")


def _avisos(usuario, tipo):
    return Notificacion.objects.todas().filter(usuario=usuario, tipo=tipo)


# --- Crear -----------------------------------------------------------------------------


def test_crear_con_enlace_manual_e_invitados(jefa, ana, nino, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = _nueva(client_for(jefa), invitee_ids=[ana.pk, nino.pk, jefa.pk, ana.pk])
    assert respuesta.status_code == 201, respuesta.json()
    datos = respuesta.json()
    assert datos["join_url"] == ENLACE
    assert datos["join_password"] == "Ñandú-2026"
    assert datos["host"]["id"] == jefa.pk and datos["is_host"] and datos["can_edit"]
    assert datos["status"] == "PROGRAMADA" and datos["status_label"] == "Programada"
    assert datos["timing"] == PROXIMA
    # El anfitrión nunca queda invitado de su propia reunión, ni nadie dos veces.
    assert sorted(i["user"]["id"] for i in datos["invitees"]) == sorted([ana.pk, nino.pk])
    assert all(i["attended"] is False for i in datos["invitees"])
    assert _avisos(ana, "reuniones.invitacion").count() == 1
    assert _avisos(nino, "reuniones.invitacion").count() == 1
    assert not _avisos(jefa, "reuniones.invitacion").exists()
    aviso = _avisos(ana, "reuniones.invitacion").get()
    assert aviso.enlace == f"/admin/gestion-humana/reuniones/{datos['id']}"


def test_la_clave_no_va_a_la_auditoria(jefa):
    _nueva(client_for(jefa))
    evento = AuditLog.objects.get(action="reuniones.creada")
    assert evento.module == "reuniones"
    assert "Ñandú-2026" not in str(evento.new_values)
    assert evento.new_values["con_clave"] is True


def test_sin_permiso_de_crear(ana):
    respuesta = _nueva(client_for(ana))
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "permission_denied"
    assert not Meeting.objects.exists()


def test_sin_sesion():
    assert APIClient().get(f"{BASE}/meetings/").status_code == 401


def test_quien_no_es_de_gestion_humana_no_entra(ajena):
    assert client_for(ajena).get(f"{BASE}/meetings/").status_code == 403


@pytest.mark.parametrize(
    "enlace",
    [
        "http://zoom.us/j/123",
        "javascript:alert(1)",
        "zoom.us/j/123",
        "https://meet.google.com/abc defg",
        "https://usuario:clave@teams.microsoft.com/l/meetup-join/1",
        "https://",
    ],
)
def test_el_enlace_tiene_que_ser_https(jefa, enlace):
    respuesta = _nueva(client_for(jefa), join_url=enlace)
    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "validation_error"
    assert "join_url" in error["details"]
    assert not Meeting.objects.exists()


def test_enlaces_de_teams_y_meet_valen(jefa):
    teams = (
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d"
    )
    assert _nueva(client_for(jefa), join_url=teams).status_code == 201
    assert (
        _nueva(client_for(jefa), join_url="https://meet.google.com/abc-defg-hij").status_code == 201
    )
    # Sin enlace también: se puede agregar después.
    sin = _nueva(client_for(jefa), join_url="", join_password="")
    assert sin.status_code == 201 and sin.json()["join_url"] is None


@pytest.mark.parametrize(
    ("campo", "valor"),
    [("title", "   "), ("duration", 0), ("duration", 24 * 60 + 1), ("meeting_date", "mañana")],
)
def test_datos_invalidos(jefa, campo, valor):
    respuesta = _nueva(client_for(jefa), **{campo: valor})
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "validation_error"
    assert campo in respuesta.json()["error"]["details"]


def test_no_se_invita_a_quien_no_tiene_acceso(jefa, ana, ajena):
    respuesta = _nueva(client_for(jefa), invitee_ids=[ana.pk, ajena.pk])
    assert respuesta.status_code == 400
    assert "invitee_ids" in respuesta.json()["error"]["details"]
    assert not Meeting.objects.exists()


def test_no_se_invita_a_una_cuenta_inactiva(jefa, ana):
    # La cuenta se desactiva por su estado (`is_active` lo sigue al guardar).
    ana.status = ana.Status.DISABLED
    ana.save()
    assert _nueva(client_for(jefa), invitee_ids=[ana.pk]).status_code == 400


def test_invitables(jefa, ana, nino, ajena):
    personas = client_for(jefa).get(f"{BASE}/invitables/").json()
    ids = {p["id"] for p in personas}
    assert {ana.pk, nino.pk} <= ids
    assert jefa.pk not in ids and ajena.pk not in ids
    assert all("email" not in p for p in personas)
    assert client_for(jefa).get(f"{BASE}/invitables/?q=niñ").json()[0]["id"] == nino.pk
    # Quien no crea reuniones no arma listas de invitados.
    assert client_for(ana).get(f"{BASE}/invitables/").status_code == 403


# --- Ver ---------------------------------------------------------------------------------


def test_cada_quien_ve_las_suyas(jefa, ana, nino, externa):
    propia = reunion_de(jefa, ana)
    otra = reunion_de(jefa, nino, title="Seguimiento de nómina")
    assert [m["id"] for m in client_for(jefa).get(f"{BASE}/meetings/").json()] == [
        propia.pk,
        otra.pk,
    ]
    assert [m["id"] for m in client_for(ana).get(f"{BASE}/meetings/").json()] == [propia.pk]
    assert client_for(externa).get(f"{BASE}/meetings/").json() == []
    # Lo ajeno no existe para quien no participa (Nexo respondía 403).
    assert client_for(externa).get(f"{BASE}/meetings/{propia.pk}/").status_code == 404
    detalle = client_for(ana).get(f"{BASE}/meetings/{propia.pk}/").json()
    assert detalle["is_host"] is False and detalle["can_edit"] is False
    assert detalle["join_url"] == ENLACE


def test_filtros_del_calendario(jefa):
    hoy = timezone.localdate()
    cerca = reunion_de(jefa, meeting_date=manana())
    reunion_de(jefa, meeting_date=manana() + timedelta(days=40))
    cliente = client_for(jefa)
    hasta = (hoy + timedelta(days=7)).isoformat()
    datos = cliente.get(f"{BASE}/meetings/?from={hoy.isoformat()}&to={hasta}").json()
    assert [m["id"] for m in datos] == [cerca.pk]
    assert cliente.get(f"{BASE}/meetings/?from=ayer").status_code == 400
    invertido = cliente.get(f"{BASE}/meetings/?from={hasta}&to={hoy.isoformat()}")
    assert invertido.status_code == 400
    assert cliente.get(f"{BASE}/meetings/?status=CANCELADA").status_code == 400
    assert cliente.get(f"{BASE}/meetings/?scope=hosted").status_code == 200


def test_momento_por_la_hora():
    ahora = timezone.now()
    reunion = Meeting(meeting_date=ahora + timedelta(minutes=5), duration=30)
    assert momento(reunion, ahora) == PROXIMA
    reunion.meeting_date = ahora - timedelta(minutes=10)
    assert momento(reunion, ahora) == EN_HORARIO
    reunion.meeting_date = ahora - timedelta(minutes=31)
    assert momento(reunion, ahora) == PASADA


# --- Editar ------------------------------------------------------------------------------


def test_solo_el_anfitrion_edita(jefa, ana, externa):
    meeting = reunion_de(jefa, ana)
    url = f"{BASE}/meetings/{meeting.pk}/"
    invitada = client_for(ana).patch(url, {"title": "Otro"}, format="json")
    assert invitada.status_code == 403
    assert client_for(externa).patch(url, {"title": "Otro"}, format="json").status_code == 404
    assert client_for(ana).delete(url).status_code == 403
    meeting.refresh_from_db()
    assert meeting.title.startswith("Comité")


def test_editar_estado_y_resumen(jefa, ana):
    meeting = reunion_de(jefa, ana)
    cliente = client_for(jefa)
    url = f"{BASE}/meetings/{meeting.pk}/"
    datos = cliente.patch(
        url,
        {
            "status": "FINALIZADA",
            "otter_invited": True,
            "otter_summary": "Acuerdos: cronograma aprobado; Óscar envía el acta.",
            "otter_transcript_url": "https://otter.ai/u/abc123",
        },
        format="json",
    ).json()
    assert datos["status"] == "FINALIZADA" and datos["otter_invited"] is True
    assert datos["otter_summary"].startswith("Acuerdos")
    malo = cliente.patch(url, {"otter_transcript_url": "ftp://otter.ai/u/1"}, format="json")
    assert malo.status_code == 400
    assert "otter_transcript_url" in malo.json()["error"]["details"]
    assert cliente.patch(url, {"status": "CANCELADA"}, format="json").status_code == 400


def test_cambiar_invitados_y_fecha_avisa(
    jefa, ana, nino, externa, django_capture_on_commit_callbacks
):
    meeting = reunion_de(jefa, ana, nino)
    MeetingInvitee.objects.filter(meeting=meeting, user=ana).update(attended=True)
    nueva_fecha = (manana() + timedelta(days=2)).isoformat()
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = client_for(jefa).patch(
            f"{BASE}/meetings/{meeting.pk}/",
            {"invitee_ids": [ana.pk, externa.pk], "meeting_date": nueva_fecha},
            format="json",
        )
    assert respuesta.status_code == 200, respuesta.json()
    invitados = {i["user"]["id"]: i["attended"] for i in respuesta.json()["invitees"]}
    # Ana sigue (con su asistencia), Niño sale y Eugenia entra.
    assert invitados == {ana.pk: True, externa.pk: False}
    assert _avisos(externa, "reuniones.invitacion").count() == 1
    assert _avisos(ana, "reuniones.cambio").count() == 1
    assert not _avisos(nino, "reuniones.cambio").exists()
    assert client_for(nino).get(f"{BASE}/meetings/{meeting.pk}/").status_code == 404
    evento = AuditLog.objects.get(action="reuniones.editada")
    assert evento.new_values["invitees_added"] == [externa.pk]
    assert evento.new_values["invitees_removed"] == [nino.pk]


def test_editar_sin_cambios_no_audita(jefa):
    meeting = reunion_de(jefa)
    client_for(jefa).patch(
        f"{BASE}/meetings/{meeting.pk}/", {"title": meeting.title}, format="json"
    )
    assert not AuditLog.objects.filter(action="reuniones.editada").exists()


# --- Eliminar ----------------------------------------------------------------------------


def test_eliminar_es_baja_logica_y_avisa(jefa, ana, django_capture_on_commit_callbacks):
    meeting = reunion_de(jefa, ana)
    url = f"{BASE}/meetings/{meeting.pk}/"
    with django_capture_on_commit_callbacks(execute=True):
        assert client_for(jefa).delete(url).status_code == 204
    meeting.refresh_from_db()
    assert meeting.deleted_at is not None and meeting.deleted_by == jefa
    assert client_for(jefa).get(url).status_code == 404
    assert client_for(ana).get(f"{BASE}/meetings/").json() == []
    assert _avisos(ana, "reuniones.cancelada").count() == 1
    assert AuditLog.objects.filter(action="reuniones.eliminada").count() == 1
    # Dos veces no: ya no existe.
    assert client_for(jefa).delete(url).status_code == 404


# --- Asistencia --------------------------------------------------------------------------


def test_marcar_asistencia(jefa, ana, nino, externa):
    meeting = reunion_de(jefa, ana, nino)
    url = f"{BASE}/meetings/{meeting.pk}/attendance/"
    cuerpo = {"attendance": [{"user_id": ana.pk, "attended": True}]}
    datos = client_for(jefa).post(url, cuerpo, format="json").json()
    marcas = {i["user"]["id"]: i["attended"] for i in datos["invitees"]}
    assert marcas == {ana.pk: True, nino.pk: False}
    # Idempotente: lo mismo otra vez no deja otra entrada en la auditoría.
    client_for(jefa).post(url, cuerpo, format="json")
    assert AuditLog.objects.filter(action="reuniones.asistencia").count() == 1

    fuera = client_for(jefa).post(
        url, {"attendance": [{"user_id": externa.pk, "attended": True}]}, format="json"
    )
    assert fuera.status_code == 400
    assert client_for(ana).post(url, cuerpo, format="json").status_code == 403
    repetida = client_for(jefa).post(
        url,
        {"attendance": [{"user_id": ana.pk, "attended": True}] * 2},
        format="json",
    )
    assert repetida.status_code == 400


# --- Administrar -------------------------------------------------------------------------


def test_quien_administra_ve_y_edita_todas(jefa, ana, admin_gh, django_capture_on_commit_callbacks):
    meeting = reunion_de(jefa, ana)
    cliente = client_for(admin_gh)
    assert cliente.get(f"{BASE}/meetings/").json() == []
    assert [m["id"] for m in cliente.get(f"{BASE}/meetings/?scope=all").json()] == [meeting.pk]
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = cliente.patch(f"{BASE}/meetings/{meeting.pk}/", {"duration": 90}, format="json")
    assert respuesta.status_code == 200 and respuesta.json()["can_edit"] is True
    # El anfitrión se entera de lo que cambió otro.
    assert _avisos(jefa, "reuniones.cambio").count() == 1
    assert client_for(jefa).get(f"{BASE}/meetings/?scope=all").status_code == 403


def test_me(jefa, ana):
    yo = client_for(jefa).get(f"{BASE}/me/").json()
    assert yo["can_create"] is True and yo["can_manage"] is False
    assert {"reuniones.acceder", "reuniones.crear"} == set(yo["permissions"])
    assert yo["limits"]["duration_max"] == 24 * 60
    assert client_for(ana).get(f"{BASE}/me/").json()["can_create"] is False
