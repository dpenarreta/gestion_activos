"""Las notas del Escritorio: crear (con adjunto), leer, fijar, archivar,
responder, eliminar y convertir en recordatorio."""

from pathlib import Path

import pytest
from rest_framework.test import APIClient

from apps.escritorio.models import DeskAuditLog, DeskNote, DeskNoteReply, PersonalReminder
from apps.notificaciones.models import Notificacion

from .conftest import BASE, PDF_BYTES, client_for, nota_de, subir

pytestmark = pytest.mark.django_db


def _avisos(usuario, tipo):
    return Notificacion.objects.todas().filter(usuario=usuario, tipo=tipo)


def _bitacora(nota):
    return list(
        DeskAuditLog.objects.filter(entity_type="NOTE", entity_id=nota.pk).values_list(
            "action", flat=True
        )
    )


def _archivos(settings) -> list[Path]:
    return [p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()]


# --- Crear -----------------------------------------------------------------------------


def test_crear_con_adjunto(ana, nino, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = client_for(ana).post(
            f"{BASE}/notes/",
            {
                "recipient": nino.pk,
                "message": "  Te dejo el acta del comité de Durán  ",
                "priority": "IMPORTANTE",
                "color": "CELESTE",
                "attachment": subir("Acta Año 2026.pdf", PDF_BYTES),
            },
            format="multipart",
        )
    assert respuesta.status_code == 201, respuesta.json()
    datos = respuesta.json()
    assert datos["message"] == "Te dejo el acta del comité de Durán"
    assert datos["priority_label"] == "Importante" and datos["color"] == "CELESTE"
    assert datos["sender"]["id"] == ana.pk and datos["recipient"]["id"] == nino.pk
    assert datos["is_mine"] is True and datos["read"] is False
    adjunto = datos["attachment"]
    assert adjunto["name"] == "Acta Año 2026.pdf" and adjunto["viewer"] == "pdf"
    assert adjunto["url"] == f"/escritorio/notes/{datos['id']}/attachment/"
    assert _avisos(nino, "escritorio.nota").count() == 1
    nota = DeskNote.objects.get()
    assert _bitacora(nota) == ["CREATED"]


def test_crear_sin_adjunto_por_json(ana, nino):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/", {"recipient": nino.pk, "message": "Hola"}, format="json"
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["priority"] == "INFORMACION" and respuesta.json()["attachment"] is None


@pytest.mark.parametrize(
    ("cuerpo", "campo"),
    [
        ({"message": "   "}, "message"),
        ({"message": "x" * 501}, "message"),
        ({"message": "Hola", "priority": "MAXIMA"}, "priority"),
        ({"message": "Hola", "color": "NEGRO"}, "color"),
    ],
)
def test_datos_invalidos(ana, nino, cuerpo, campo):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/", {"recipient": nino.pk, **cuerpo}, format="json"
    )
    assert respuesta.status_code == 400
    assert respuesta.json()["error"]["code"] == "validation_error"
    assert campo in respuesta.json()["error"]["details"]


def test_destinatarios_validos(ana, nino, ajena):
    cliente = client_for(ana)
    a_si_misma = cliente.post(
        f"{BASE}/notes/", {"recipient": ana.pk, "message": "Yo"}, format="json"
    )
    assert a_si_misma.status_code == 400
    sin_acceso = cliente.post(
        f"{BASE}/notes/", {"recipient": ajena.pk, "message": "Hola"}, format="json"
    )
    assert sin_acceso.status_code == 400
    assert "recipient" in sin_acceso.json()["error"]["details"]
    ids = {p["id"] for p in cliente.get(f"{BASE}/notes/recipients/").json()}
    assert nino.pk in ids and ana.pk not in ids and ajena.pk not in ids
    assert not DeskNote.objects.exists()


def test_un_ejecutable_renombrado_no_entra(ana, nino, settings):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/",
        {"recipient": nino.pk, "message": "Hola", "attachment": subir("acta.pdf", b"MZ\x90\x00")},
        format="multipart",
    )
    assert respuesta.status_code == 400
    assert "attachment" in respuesta.json()["error"]["details"]
    assert not DeskNote.objects.exists() and _archivos(settings) == []


def test_sin_sesion_y_sin_permiso(ajena):
    assert APIClient().get(f"{BASE}/notes/").status_code == 401
    assert client_for(ajena).get(f"{BASE}/notes/").status_code == 403


# --- Bandeja -------------------------------------------------------------------------


def test_vistas_de_la_bandeja(ana, nino):
    recibida = nota_de(ana, nino)
    fijada = nota_de(ana, nino, pinned=True)
    archivada = nota_de(ana, nino, archived=True)
    cliente = client_for(nino)
    assert [n["id"] for n in cliente.get(f"{BASE}/notes/").json()] == [fijada.pk, recibida.pk]
    assert [n["id"] for n in cliente.get(f"{BASE}/notes/?view=pinned").json()] == [fijada.pk]
    assert [n["id"] for n in cliente.get(f"{BASE}/notes/?view=archive").json()] == [archivada.pk]
    assert cliente.get(f"{BASE}/notes/?view=sent").json() == []
    enviadas = client_for(ana).get(f"{BASE}/notes/?view=sent&limit=2").json()
    assert len(enviadas) == 2
    assert cliente.get(f"{BASE}/notes/?view=papelera").status_code == 400
    assert cliente.get(f"{BASE}/notes/unread-count/").json() == {"unread": 2}


def test_lo_ajeno_no_existe(ana, nino, externa):
    nota = nota_de(ana, nino)
    cliente = client_for(externa)
    for ruta in ("", "replies/", "history/", "attachment/"):
        assert cliente.get(f"{BASE}/notes/{nota.pk}/{ruta}").status_code == 404, ruta
    assert (
        cliente.patch(f"{BASE}/notes/{nota.pk}/", {"action": "read"}, format="json").status_code
        == 404
    )
    assert cliente.delete(f"{BASE}/notes/{nota.pk}/").status_code == 404


# --- Acciones del destinatario ---------------------------------------------------------


def test_leer_avisa_al_remitente_una_vez(ana, nino, django_capture_on_commit_callbacks):
    nota = nota_de(ana, nino)
    url = f"{BASE}/notes/{nota.pk}/"
    with django_capture_on_commit_callbacks(execute=True):
        datos = client_for(nino).patch(url, {"action": "read"}, format="json").json()
        client_for(nino).patch(url, {"action": "read"}, format="json")
    assert datos["read"] is True and datos["read_at"]
    assert _avisos(ana, "escritorio.leida").count() == 1
    assert _bitacora(nota) == ["READ"]


def test_fijar_y_archivar_son_del_destinatario(ana, nino):
    nota = nota_de(ana, nino)
    url = f"{BASE}/notes/{nota.pk}/"
    remitente = client_for(ana).patch(url, {"action": "pin"}, format="json")
    assert remitente.status_code == 403
    cliente = client_for(nino)
    assert cliente.patch(url, {"action": "pin"}, format="json").json()["pinned"] is True
    cliente.patch(url, {"action": "pin"}, format="json")
    assert cliente.patch(url, {"action": "archive"}, format="json").json()["archived"] is True
    assert cliente.patch(url, {"action": "unarchive"}, format="json").json()["archived"] is False
    assert cliente.patch(url, {"action": "borrar"}, format="json").status_code == 400
    # Fijar dos veces deja una sola entrada.
    assert _bitacora(nota) == ["PINNED", "ARCHIVED", "UNARCHIVED"]


# --- Respuestas ------------------------------------------------------------------------


def test_respuestas_hasta_el_tope(ana, nino, django_capture_on_commit_callbacks):
    nota = nota_de(ana, nino)
    url = f"{BASE}/notes/{nota.pk}/replies/"
    with django_capture_on_commit_callbacks(execute=True):
        primera = client_for(nino).post(url, {"message": "Listo, lo reviso mañana"}, format="json")
        segunda = client_for(ana).post(url, {"message": "Gracias, Niño"}, format="json")
    assert primera.status_code == 201 and segunda.status_code == 201
    assert primera.json()["author"]["id"] == nino.pk
    assert _avisos(ana, "escritorio.respuesta").count() == 1
    assert _avisos(nino, "escritorio.respuesta").count() == 1
    tercera = client_for(nino).post(url, {"message": "Una más"}, format="json")
    assert tercera.status_code == 409 and tercera.json()["error"]["code"] == "conflict"
    assert [r["message"] for r in client_for(ana).get(url).json()] == [
        "Listo, lo reviso mañana",
        "Gracias, Niño",
    ]
    detalle = client_for(ana).get(f"{BASE}/notes/{nota.pk}/").json()
    assert detalle["reply_count"] == 2 and detalle["can_reply"] is False
    vacia = client_for(nino).post(url, {"message": "  "}, format="json")
    assert vacia.status_code == 400 and "message" in vacia.json()["error"]["details"]
    assert DeskNoteReply.objects.count() == 2


# --- Eliminar --------------------------------------------------------------------------


def test_el_remitente_la_manda_a_la_papelera(ana, nino):
    nota = nota_de(ana, nino)
    assert client_for(ana).delete(f"{BASE}/notes/{nota.pk}/").status_code == 204
    nota.refresh_from_db()
    assert nota.deleted_at is not None
    assert client_for(nino).get(f"{BASE}/notes/").json() == []
    assert client_for(nino).get(f"{BASE}/notes/{nota.pk}/").status_code == 404
    assert _bitacora(nota) == ["DELETED"]


def test_el_destinatario_solo_elimina_lo_archivado(
    ana, nino, settings, django_capture_on_commit_callbacks
):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/",
        {"recipient": nino.pk, "message": "Con acta", "attachment": subir("acta.pdf", PDF_BYTES)},
        format="multipart",
    )
    pk = respuesta.json()["id"]
    url = f"{BASE}/notes/{pk}/"
    cliente = client_for(nino)
    sin_archivar = cliente.delete(url)
    assert sin_archivar.status_code == 409
    cliente.patch(url, {"action": "archive"}, format="json")
    # El archivo se borra al confirmar (si la transacción se deshace, sigue).
    with django_capture_on_commit_callbacks(execute=True):
        assert cliente.delete(url).status_code == 204
    assert not DeskNote.objects.filter(pk=pk).exists()
    # La bitácora sobrevive a la nota; el archivo, no.
    assert DeskAuditLog.objects.filter(entity_id=pk, action="DELETED").exists()
    assert _archivos(settings) == []


# --- Adjunto ---------------------------------------------------------------------------


def test_el_adjunto_lo_ven_los_dos(ana, nino):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/",
        {"recipient": nino.pk, "message": "Acta", "attachment": subir("acta.pdf", PDF_BYTES)},
        format="multipart",
    )
    url = f"{BASE}/notes/{respuesta.json()['id']}/attachment/"
    for persona in (ana, nino):
        archivo = client_for(persona).get(url)
        assert archivo.status_code == 200
        assert archivo["Content-Disposition"].startswith("inline")
        assert archivo["X-Content-Type-Options"] == "nosniff"
        assert b"".join(archivo.streaming_content) == PDF_BYTES
    assert client_for(nino).get(f"{url}?download=1")["Content-Disposition"].startswith("attachment")
    sin = nota_de(ana, nino)
    assert client_for(nino).get(f"{BASE}/notes/{sin.pk}/attachment/").status_code == 404


# --- Convertir en recordatorio ---------------------------------------------------------


def test_convertir_en_recordatorio_copia_el_adjunto(ana, nino, settings):
    respuesta = client_for(ana).post(
        f"{BASE}/notes/",
        {
            "recipient": nino.pk,
            "message": "Enviar el certificado a Begoña " + "x" * 200,
            "priority": "URGENTE",
            "attachment": subir("certificado.pdf", PDF_BYTES),
        },
        format="multipart",
    )
    pk = respuesta.json()["id"]
    url = f"{BASE}/notes/{pk}/convert-to-reminder/"
    cuerpo = {"due_at": "2026-12-01T09:00:00-05:00"}
    assert client_for(ana).post(url, cuerpo, format="json").status_code == 403
    convertida = client_for(nino).post(url, cuerpo, format="json")
    assert convertida.status_code == 201, convertida.json()
    datos = convertida.json()["reminder"]
    assert datos["priority"] == "URGENTE"
    assert len(datos["title"]) == 150 and datos["title"].endswith("…")
    assert datos["attachment"]["name"] == "certificado.pdf"
    recordatorio = PersonalReminder.objects.get()
    nota = DeskNote.objects.get(pk=pk)
    assert recordatorio.attachment.name != nota.attachment.name
    assert len(_archivos(settings)) == 2
    assert nota.converted_to_reminder_id == recordatorio.pk
    assert _bitacora(nota)[-1] == "CONVERTED_TO_REMINDER"
    # Una sola vez.
    otra = client_for(nino).post(url, cuerpo, format="json")
    assert otra.status_code == 409
    assert PersonalReminder.objects.count() == 1
    sin_fecha = client_for(nino).post(url, {}, format="json")
    assert sin_fecha.status_code == 400 and "due_at" in sin_fecha.json()["error"]["details"]


def test_historial_de_la_nota(ana, nino):
    nota = nota_de(ana, nino)
    client_for(nino).patch(f"{BASE}/notes/{nota.pk}/", {"action": "read"}, format="json")
    eventos = client_for(ana).get(f"{BASE}/notes/{nota.pk}/history/").json()
    assert [e["action"] for e in eventos] == ["READ"]
    assert eventos[0]["action_label"] == "Leído" and eventos[0]["user"]["id"] == nino.pk
