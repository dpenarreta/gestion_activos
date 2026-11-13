"""El correo de una solicitud aprobada, con su documento de respaldo
(US-019, 13/11/2026): sale a quienes el tipo de permiso avisa «también por
correo» en «Si se aprueba» (p. ej. la Analista de Clima y Cultura)."""

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.licencias.models import AvisoFlujo
from apps.licencias.tests.test_licencias import (  # noqa: F401 (fixture)
    FLUJOS,
    SOLICITUDES,
    empresa_con_organigrama,
)
from apps.notificaciones.models import Notificacion

pytestmark = pytest.mark.django_db


@pytest.fixture
def e(empresa_con_organigrama):  # noqa: F811 (el fixture importado)
    return empresa_con_organigrama


def _calamidad(e, *, con_correo=True):
    """Un tipo de un solo paso (el jefe inmediato) que avisa a Tatiana, por
    correo si `con_correo`, y a quien pidió solo en la campana."""
    _, admin = e["admin"]
    tatiana = e["th"][0]
    respuesta = admin.post(
        FLUJOS,
        {
            "nombre": "Calamidad doméstica",
            "adjunto": "opcional",
            "pasos": [{"nombre": "Jefatura", "aprobadores": [{"tipo": "jefe_inmediato"}]}],
            "avisos_aprobada": [
                {"tipo": "persona", "usuario": tatiana.pk, "correo": con_correo},
                {"tipo": "solicitante"},
            ],
            "avisos_rechazada": [{"tipo": "solicitante", "correo": True}],
        },
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def _pedir_con_respaldo(e, flujo_id):
    _, ana = e["ana"]
    respuesta = ana.post(
        SOLICITUDES,
        {
            "flujo": flujo_id,
            "desde": "2026-11-02",
            "hasta": "2026-11-03",
            "motivo": "Inundación en casa",
            "adjunto": SimpleUploadedFile(
                "parte-policial.pdf", b"%PDF-1.4 parte", content_type="application/pdf"
            ),
        },
        format="multipart",
    )
    assert respuesta.status_code == 201, respuesta.data
    return respuesta.json()


def test_el_tipo_guarda_y_devuelve_quien_recibe_correo(e):
    flujo = _calamidad(e)
    correo = {a["tipo"]: a["correo"] for a in flujo["avisos_aprobada"]}
    assert correo == {"persona": True, "solicitante": False}
    # En «Si se rechaza» no existe el correo: se ignora.
    assert flujo["avisos_rechazada"][0]["correo"] is False
    assert not AvisoFlujo.objects.todas().filter(resultado="rechazada", correo=True).exists()


def test_al_aprobarse_le_llega_el_correo_con_el_respaldo(e, django_capture_on_commit_callbacks):
    flujo = _calamidad(e)
    solicitud = _pedir_con_respaldo(e, flujo["id"])
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = e["jefa"][1].post(f"{SOLICITUDES}{solicitud['id']}/aprobar/")
    assert respuesta.status_code == 200, respuesta.data

    (correo,) = mail.outbox
    assert correo.bcc == [e["th"][0].email]  # solo a quien tiene «también por correo»
    assert "Calamidad doméstica" in correo.subject and "Ana" in correo.subject
    cuerpo = correo.alternatives[0][0]
    assert "del 02/11/2026 al 03/11/2026" in cuerpo
    assert "Inundación en casa" in cuerpo
    assert "Julia" in cuerpo  # quién lo aprobó
    assert correo.attachments == [("parte-policial.pdf", b"%PDF-1.4 parte", "application/pdf")]
    # La campana llega igual a los dos avisos, sin repetirse por el correo.
    avisados = Notificacion.objects.todas().filter(tipo="licencias.aprobada")
    assert sorted(avisados.values_list("usuario__username", flat=True)) == ["ana", "tatiana"]


def test_sin_marcar_el_correo_solo_avisa_en_la_campana(e, django_capture_on_commit_callbacks):
    flujo = _calamidad(e, con_correo=False)
    solicitud = _pedir_con_respaldo(e, flujo["id"])
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        e["jefa"][1].post(f"{SOLICITUDES}{solicitud['id']}/aprobar/")
    assert mail.outbox == []


def test_un_rechazo_no_manda_el_correo(e, django_capture_on_commit_callbacks):
    flujo = _calamidad(e)
    solicitud = _pedir_con_respaldo(e, flujo["id"])
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        e["jefa"][1].post(f"{SOLICITUDES}{solicitud['id']}/rechazar/", {"comentario": "No procede"})
    assert mail.outbox == []
