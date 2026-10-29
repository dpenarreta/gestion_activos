"""Adjuntos en la respuesta a una observación del rol de pagos (22/10/2026).

Lo que se protege:

- Talento Humano responde con imágenes o archivos (hasta 5, con las reglas de
  los adjuntos: tipo, tamaño y contenido); quedan en el historial con la
  respuesta.
- Los abren la persona de la observación y Talento Humano; nadie más.
- Un archivo que no es lo que dice ser no entra, y la respuesta no se guarda.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.core.models import AuditLog
from apps.nomina.tests.test_rol_pagos import BASE, _con_codigo, _consultar

LISTA = "/api/v1/nomina/observaciones/"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
PDF = b"%PDF-1.4 prueba"


@pytest.fixture(autouse=True)
def _entorno(tmp_path):
    with override_settings(
        NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True, MEDIA_ROOT=str(tmp_path)
    ):
        yield


def _observacion():
    _, rosa = _con_codigo("rosa", "20100001")
    _, th = _con_codigo("tatiana", "20100099", "roles_pago.observaciones")
    consulta = _consultar(rosa)["X-Consulta-Rol"]
    rosa.post(
        f"{BASE}conformidad/",
        {"consulta": consulta, "conformidad": "observacion", "observacion": "Faltan horas."},
        format="json",
    )
    return rosa, th, th.get(LISTA).json()[0]["id"]


def _responder(cliente, observacion_id, *archivos, nota="Se sumaron las horas."):
    return cliente.post(
        f"{LISTA}{observacion_id}/corregir/",
        {"nota": nota, "archivos": list(archivos)},
        format="multipart",
    )


def test_la_respuesta_lleva_archivos_y_quedan_en_el_historial(db):
    rosa, th, observacion_id = _observacion()
    respuesta = _responder(
        th,
        observacion_id,
        SimpleUploadedFile("captura nómina.png", PNG, content_type="image/png"),
        SimpleUploadedFile("detalle.pdf", PDF, content_type="application/pdf"),
    )
    assert respuesta.status_code == 200, respuesta.data
    correccion = respuesta.json()["mensajes"][-1]
    assert correccion["tipo"] == "correccion"
    assert [(a["nombre"], a["es_imagen"]) for a in correccion["adjuntos"]] == [
        ("captura nómina.png", True),
        ("detalle.pdf", False),
    ]

    # La persona los ve en sus observaciones y los abre.
    mias = rosa.get(f"{BASE}mis-observaciones/").json()
    adjunto = mias[0]["mensajes"][-1]["adjuntos"][0]
    descarga = rosa.get(f"{LISTA}adjuntos/{adjunto['id']}/")
    assert descarga.status_code == 200
    assert b"".join(descarga.streaming_content) == PNG
    assert "attachment" in descarga["Content-Disposition"]
    assert descarga["X-Content-Type-Options"] == "nosniff"
    assert AuditLog.objects.filter(action="roles_pago.observacion.adjunto_descargado").exists()

    # En el historial por código, con la respuesta.
    _, historial = _con_codigo("hilda", "20100090", "roles_pago.historial")
    periodo = historial.get("/api/v1/nomina/historial/", {"codigo": "20100001"}).json()["periodos"][
        0
    ]
    mensajes = periodo["observacion"]["mensajes"]
    assert [a["nombre"] for a in mensajes[-1]["adjuntos"]] == ["captura nómina.png", "detalle.pdf"]
    assert historial.get(f"{LISTA}adjuntos/{adjunto['id']}/").status_code == 200


def test_nadie_mas_abre_los_adjuntos(db):
    _, th, observacion_id = _observacion()
    adjunto = _responder(
        th, observacion_id, SimpleUploadedFile("a.png", PNG, content_type="image/png")
    ).json()["mensajes"][-1]["adjuntos"][0]
    _, curioso = _con_codigo("pablo", "20100097")
    assert curioso.get(f"{LISTA}adjuntos/{adjunto['id']}/").status_code == 404


def test_un_archivo_disfrazado_o_de_mas_no_entra(db):
    _, th, observacion_id = _observacion()
    disfrazado = SimpleUploadedFile("factura.pdf", b"MZ\x90\x00ejecutable")
    respuesta = _responder(th, observacion_id, disfrazado)
    assert respuesta.status_code == 400
    assert "factura.pdf" in str(respuesta.json())
    # La respuesta no se guardó: sigue por atender.
    assert th.get(f"{LISTA}{observacion_id}/").json()["estado"] == "abierta"
    seis = [SimpleUploadedFile(f"{i}.png", PNG, content_type="image/png") for i in range(6)]
    assert _responder(th, observacion_id, *seis).status_code == 400
    # Sin archivos sigue funcionando como antes.
    assert _responder(th, observacion_id).json()["estado"] == "corregida"


def test_el_tipo_sale_de_la_extension_y_no_del_navegador(db):
    """Auditoría de seguridad, 29/10/2026: un «text/html» declarado por el
    cliente se guardaba y se devolvía tal cual."""
    from apps.nomina.models import AdjuntoObservacion

    rosa, th, observacion_id = _observacion()
    adjunto = _responder(
        th, observacion_id, SimpleUploadedFile("captura.png", PNG, content_type="text/html")
    ).json()["mensajes"][-1]["adjuntos"][0]
    assert AdjuntoObservacion.objects.get(pk=adjunto["id"]).content_type == "image/png"

    # Uno guardado antes del arreglo con el tipo del cliente se sirve con el derivado.
    AdjuntoObservacion.objects.filter(pk=adjunto["id"]).update(content_type="text/html")
    descarga = rosa.get(f"{LISTA}adjuntos/{adjunto['id']}/")
    assert descarga.status_code == 200
    assert descarga["Content-Type"] == "image/png"
