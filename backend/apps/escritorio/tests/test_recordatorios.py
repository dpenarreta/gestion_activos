"""Los recordatorios del Escritorio, su aviso al vencer (el ciclo), la
conversión en tarea, la bandeja «Hoy» y el buscador."""

from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.utils import timezone

from apps.escritorio import services
from apps.escritorio.models import DeskAuditLog, DeskNote, PersonalReminder
from apps.notificaciones.models import Notificacion
from apps.tasks.models import Task

from .conftest import BASE, PDF_BYTES, client_for, make_user, nota_de, recordatorio_de, subir

pytestmark = pytest.mark.django_db


def _bitacora(r):
    return list(
        DeskAuditLog.objects.filter(entity_type="REMINDER", entity_id=r.pk).values_list(
            "action", flat=True
        )
    )


def _avisos(usuario):
    return Notificacion.objects.todas().filter(usuario=usuario, tipo="escritorio.recordatorio")


# --- Crear y editar --------------------------------------------------------------------


def test_crear_y_listar(ana):
    cliente = client_for(ana)
    respuesta = cliente.post(
        f"{BASE}/reminders/",
        {
            "title": "  Renovar el contrato de Óscar  ",
            "description": "Con el anexo de teletrabajo",
            "due_at": "2026-12-15T09:30:00-05:00",
            "priority": "ALTA",
            "repeat": "MENSUAL",
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.json()
    datos = respuesta.json()
    assert datos["title"] == "Renovar el contrato de Óscar"
    assert datos["priority_label"] == "Alta" and datos["repeat_label"] == "Mensual"
    assert datos["status"] == "PENDIENTE" and datos["attachment"] is None
    assert [r["id"] for r in cliente.get(f"{BASE}/reminders/").json()] == [datos["id"]]
    assert _bitacora(PersonalReminder.objects.get()) == ["CREATED"]


@pytest.mark.parametrize(
    ("cuerpo", "campo"),
    [
        ({"title": " ", "due_at": "2026-12-15T09:30:00Z"}, "title"),
        ({"title": "x" * 151, "due_at": "2026-12-15T09:30:00Z"}, "title"),
        ({"title": "Algo"}, "due_at"),
        ({"title": "Algo", "due_at": "2026-12-15T09:30:00Z", "repeat": "ANUAL"}, "repeat"),
    ],
)
def test_datos_invalidos(ana, cuerpo, campo):
    respuesta = client_for(ana).post(f"{BASE}/reminders/", cuerpo, format="json")
    assert respuesta.status_code == 400
    assert campo in respuesta.json()["error"]["details"]


def test_el_recordatorio_ajeno_no_existe(ana, nino):
    r = recordatorio_de(ana)
    cliente = client_for(nino)
    for ruta in ("", "history/", "attachment/"):
        assert cliente.get(f"{BASE}/reminders/{r.pk}/{ruta}").status_code == 404, ruta
    assert (
        cliente.patch(f"{BASE}/reminders/{r.pk}/", {"action": "complete"}, format="json")
    ).status_code == 404
    assert cliente.delete(f"{BASE}/reminders/{r.pk}/").status_code == 404
    assert cliente.get(f"{BASE}/reminders/").json() == []


def test_editar_prioridad_y_fecha(ana):
    r = recordatorio_de(ana, notified=True)
    url = f"{BASE}/reminders/{r.pk}/"
    cliente = client_for(ana)
    assert cliente.patch(url, {"priority": "URGENTE"}, format="json").json()["priority"] == (
        "URGENTE"
    )
    nueva = (timezone.now() + timedelta(days=3)).isoformat()
    cliente.patch(url, {"due_at": nueva}, format="json")
    cliente.patch(url, {"title": r.title}, format="json")  # Sin cambios: nada.
    r.refresh_from_db()
    assert r.notified is False
    assert _bitacora(r) == ["PRIORITY_CHANGED", "EDITED"]
    assert cliente.patch(url, {"title": ""}, format="json").status_code == 400


# --- Acciones --------------------------------------------------------------------------


def test_completar_un_repetitivo_crea_la_siguiente(ana):
    vence = datetime(2026, 1, 31, 14, 0, tzinfo=UTC)
    r = recordatorio_de(ana, due_at=vence, repeat="MENSUAL")
    url = f"{BASE}/reminders/{r.pk}/"
    datos = client_for(ana).patch(url, {"action": "complete"}, format="json").json()
    assert datos["status"] == "COMPLETADO" and datos["completed_at"]
    siguiente = PersonalReminder.objects.exclude(pk=r.pk).get()
    assert siguiente.due_at == datetime(2026, 2, 28, 14, 0, tzinfo=UTC)
    assert siguiente.status == "PENDIENTE" and siguiente.repeat == "MENSUAL"
    # Un doble clic no crea otra ocurrencia.
    otra = client_for(ana).patch(url, {"action": "complete"}, format="json")
    assert otra.status_code == 409
    assert PersonalReminder.objects.count() == 2
    assert _bitacora(siguiente) == ["CREATED"]


def test_siguiente_ocurrencia():
    base = datetime(2026, 12, 31, 8, 30, tzinfo=UTC)
    assert services.siguiente_ocurrencia(base, "DIARIO") == datetime(2027, 1, 1, 8, 30, tzinfo=UTC)
    assert services.siguiente_ocurrencia(base, "SEMANAL") == datetime(2027, 1, 7, 8, 30, tzinfo=UTC)
    assert services.siguiente_ocurrencia(base, "MENSUAL") == datetime(
        2027, 1, 31, 8, 30, tzinfo=UTC
    )
    assert services.siguiente_ocurrencia(base, "UNA_VEZ") == base


def test_posponer_reabrir_y_archivar(ana):
    r = recordatorio_de(ana, notified=True)
    url = f"{BASE}/reminders/{r.pk}/"
    cliente = client_for(ana)
    sin_fecha = cliente.patch(url, {"action": "postpone"}, format="json")
    assert sin_fecha.status_code == 400
    luego = (timezone.now() + timedelta(days=1)).isoformat()
    pospuesto = cliente.patch(url, {"action": "postpone", "due_at": luego}, format="json")
    assert pospuesto.status_code == 200
    r.refresh_from_db()
    assert r.notified is False
    pendiente = cliente.patch(url, {"action": "reopen"}, format="json")
    assert pendiente.status_code == 409
    cliente.patch(url, {"action": "complete"}, format="json")
    cliente.patch(url, {"action": "archive"}, format="json")
    assert cliente.get(f"{BASE}/reminders/").json() == []
    assert [x["id"] for x in cliente.get(f"{BASE}/reminders/?archived=true").json()] == [r.pk]
    reabierto = cliente.patch(url, {"action": "reopen"}, format="json").json()
    assert reabierto["status"] == "PENDIENTE" and reabierto["archived"] is False
    assert cliente.patch(url, {"action": "olvidar"}, format="json").status_code == 400
    assert _bitacora(r) == ["POSTPONED", "COMPLETED", "ARCHIVED", "REOPENED"]


def test_eliminar_deja_la_bitacora(ana):
    r = recordatorio_de(ana)
    pk = r.pk
    assert client_for(ana).delete(f"{BASE}/reminders/{pk}/").status_code == 204
    assert not PersonalReminder.objects.filter(pk=pk).exists()
    assert DeskAuditLog.objects.filter(entity_id=pk, action="DELETED").exists()


def test_filtros_del_calendario(ana):
    cerca = recordatorio_de(ana, due_at=datetime(2026, 12, 10, 15, tzinfo=UTC))
    recordatorio_de(ana, due_at=datetime(2027, 3, 10, 15, tzinfo=UTC))
    cliente = client_for(ana)
    datos = cliente.get(f"{BASE}/reminders/?from=2026-12-01&to=2026-12-31T23:59:59Z").json()
    assert [r["id"] for r in datos] == [cerca.pk]
    assert cliente.get(f"{BASE}/reminders/?from=diciembre").status_code == 400
    assert cliente.get(f"{BASE}/reminders/?status=HECHO").status_code == 400
    assert len(cliente.get(f"{BASE}/reminders/?limit=1").json()) == 1


# --- Aviso al vencer (el ciclo) --------------------------------------------------------


def test_el_ciclo_avisa_una_vez(ana, nino, django_capture_on_commit_callbacks):
    vencido = recordatorio_de(ana, due_at=timezone.now() - timedelta(minutes=1))
    recordatorio_de(ana, due_at=timezone.now() + timedelta(hours=1))
    recordatorio_de(nino, due_at=timezone.now() - timedelta(days=1), status="COMPLETADO")
    salida = StringIO()
    with django_capture_on_commit_callbacks(execute=True):
        call_command("ciclo_escritorio", stdout=salida)
        call_command("ciclo_escritorio", stdout=salida)
    assert "1 recordatorios vencidos avisados" in salida.getvalue()
    aviso = _avisos(ana).get()
    assert "Llamar a Begoña" in aviso.resumen
    assert aviso.enlace == f"/admin/gestion-humana/escritorio?recordatorio={vencido.pk}"
    assert not _avisos(nino).exists()
    vencido.refresh_from_db()
    assert vencido.notified is True


def test_posponer_rearma_el_aviso(ana, django_capture_on_commit_callbacks):
    r = recordatorio_de(ana, due_at=timezone.now() - timedelta(minutes=1))
    with django_capture_on_commit_callbacks(execute=True):
        services.avisar_vencidos()
    client_for(ana).patch(
        f"{BASE}/reminders/{r.pk}/",
        {"action": "postpone", "due_at": (timezone.now() - timedelta(seconds=1)).isoformat()},
        format="json",
    )
    with django_capture_on_commit_callbacks(execute=True):
        assert services.avisar_vencidos() == 1
    assert _avisos(ana).count() == 2


def test_al_abrir_el_escritorio_tambien_avisa(ana, django_capture_on_commit_callbacks):
    recordatorio_de(ana, due_at=timezone.now() - timedelta(minutes=1))
    with django_capture_on_commit_callbacks(execute=True):
        client_for(ana).get(f"{BASE}/reminders/")
    assert _avisos(ana).count() == 1


def test_el_ciclo_purga_el_archivo_y_la_papelera(
    ana, nino, settings, django_capture_on_commit_callbacks
):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/",
        {"recipient": nino.pk, "message": "Acta", "attachment": subir("acta.pdf", PDF_BYTES)},
        format="multipart",
    )
    vieja = DeskNote.objects.get(pk=respuesta.json()["id"])
    DeskNote.objects.filter(pk=vieja.pk).update(
        archived=True, archived_at=timezone.now() - timedelta(days=16)
    )
    reciente = nota_de(ana, nino, archived=True, archived_at=timezone.now() - timedelta(days=2))
    en_papelera = nota_de(ana, nino, deleted_at=timezone.now() - timedelta(hours=49))
    recien_borrada = nota_de(ana, nino, deleted_at=timezone.now() - timedelta(hours=1))

    simulado = StringIO()
    call_command("ciclo_escritorio", "--simular", stdout=simulado)
    assert "1 notas archivadas y 1 de la papelera" in simulado.getvalue()
    assert DeskNote.objects.count() == 4

    with django_capture_on_commit_callbacks(execute=True):
        call_command("ciclo_escritorio", stdout=StringIO())
    restantes = set(DeskNote.objects.values_list("pk", flat=True))
    assert restantes == {reciente.pk, recien_borrada.pk}
    motivos = {
        e.metadata["reason"]
        for e in DeskAuditLog.objects.filter(
            entity_type="NOTE", entity_id__in=[vieja.pk, en_papelera.pk], action="DELETED"
        )
    }
    assert motivos == {"archive_retention_expired", "trash_retention_expired"}
    # El adjunto de la purgada se fue con ella.
    assert [p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()] == []


# --- Convertir en tarea ----------------------------------------------------------------


def test_convertir_en_tarea(ana):
    r = recordatorio_de(ana, priority="URGENTE", description="Con el anexo")
    url = f"{BASE}/reminders/{r.pk}/convert-to-task/"
    cuerpo = {
        "start_date": "2026-12-01T08:00:00-05:00",
        "end_date": "2026-12-05T17:00:00-05:00",
        "estimated_hours": 4,
    }
    respuesta = client_for(ana).post(url, cuerpo, format="json")
    assert respuesta.status_code == 201, respuesta.json()
    tarea = Task.objects.get(pk=respuesta.json()["task_id"])
    assert tarea.assigned_to == ana and tarea.created_by == ana
    assert tarea.priority == "ALTA" and tarea.type == "SEGUIMIENTO"
    assert tarea.title == r.title and tarea.description == "Con el anexo"
    r.refresh_from_db()
    assert r.converted_to_task_id == tarea.pk and r.converted_to_task_at
    assert client_for(ana).post(url, cuerpo, format="json").status_code == 409
    assert Task.objects.count() == 1
    assert _bitacora(r)[-1] == "CONVERTED_TO_TASK"


def test_convertir_en_tarea_valida_las_fechas(ana):
    r = recordatorio_de(ana)
    url = f"{BASE}/reminders/{r.pk}/convert-to-task/"
    invertidas = client_for(ana).post(
        url,
        {
            "start_date": "2026-12-05T08:00:00Z",
            "end_date": "2026-12-01T08:00:00Z",
            "estimated_hours": 2,
        },
        format="json",
    )
    assert invertidas.status_code == 400
    sin_horas = client_for(ana).post(
        url,
        {
            "start_date": "2026-12-01T08:00:00Z",
            "end_date": "2026-12-02T08:00:00Z",
            "estimated_hours": 0,
        },
        format="json",
    )
    assert sin_horas.status_code == 400
    assert not Task.objects.exists()


def test_convertir_en_tarea_pide_acceso_a_tareas():
    solo_escritorio, _ = Group.objects.get_or_create(name="Solo escritorio")
    solo_escritorio.permissions.set(Permission.objects.filter(codename="escritorio.acceder"))
    persona = make_user("solo", "Solo escritorio")
    r = recordatorio_de(persona)
    respuesta = client_for(persona).post(
        f"{BASE}/reminders/{r.pk}/convert-to-task/",
        {
            "start_date": "2026-12-01T08:00:00Z",
            "end_date": "2026-12-02T08:00:00Z",
            "estimated_hours": 1,
        },
        format="json",
    )
    assert respuesta.status_code == 403
    assert client_for(persona).get(f"{BASE}/me/").json()["can_convert_to_task"] is False
    assert client_for(persona).get(f"{BASE}/today/").json()["upcoming_tasks"] is None


# --- Hoy, el buscador y me/ ------------------------------------------------------------


def test_hoy(ana, nino):
    nota_de(nino, ana, message="Urgente: firmar el acta")
    nota_de(nino, ana, read=True)
    hoy = recordatorio_de(ana, due_at=timezone.now() - timedelta(minutes=5))
    recordatorio_de(ana, due_at=timezone.now() + timedelta(days=5))
    datos = client_for(ana).get(f"{BASE}/today/").json()
    assert [n["message"] for n in datos["pending_notes"]] == ["Urgente: firmar el acta"]
    assert datos["pending_notes"][0]["sender_name"] == "Niño"
    assert [r["id"] for r in datos["today_reminders"]] == [hoy.pk]
    assert datos["today_reminders"][0]["overdue"] is True
    assert datos["upcoming_tasks"] == []


def test_buscar(ana, nino):
    nota = nota_de(ana, nino, message="Cronograma de vacaciones", priority="URGENTE")
    nota.replies.create(author=nino, message="¿Incluye a Peñaherrera?")
    nota_de(nino, ana, message="Otra cosa")
    recordatorio_de(ana, title="Vacaciones de Óscar")
    cliente = client_for(ana)
    datos = cliente.get(f"{BASE}/search/?q=vacaciones").json()
    assert [n["id"] for n in datos["notes"]] == [nota.pk]
    assert [r["title"] for r in datos["reminders"]] == ["Vacaciones de Óscar"]
    por_respuesta = cliente.get(f"{BASE}/search/?q=peñaherrera").json()
    assert [n["id"] for n in por_respuesta["notes"]] == [nota.pk]
    por_persona = cliente.get(f"{BASE}/search/?recipient=niñ&priority=URGENTE").json()
    assert [n["id"] for n in por_persona["notes"]] == [nota.pk]
    assert cliente.get(f"{BASE}/search/?date=ayer").status_code == 400
    # Lo de otros no aparece.
    assert client_for(make_user("otra", "ANALISTA_CC")).get(
        f"{BASE}/search/?q=vacaciones"
    ).json() == {"notes": [], "reminders": []}


def test_me(ana, nino):
    nota_de(nino, ana)
    yo = client_for(ana).get(f"{BASE}/me/").json()
    assert yo["permissions"] == ["escritorio.acceder"]
    assert yo["unread_notes"] == 1 and yo["can_convert_to_task"] is True
    assert yo["settings"] == {
        "max_replies": 2,
        "archive_retention_days": 15,
        "trash_retention_hours": 48,
        "snooze_presets_minutes": [15, 30, 60, 1440],
    }
    assert ".pdf" in yo["attachment"]["extensions"]
