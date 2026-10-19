"""Códigos de conducta y reglamentos (módulo Institucional).

Lo que se protege (19/10/2026): toda persona con sesión lee los vigentes de
su empresa; publicar, editar y retirar pide `codigos.publicar`; solo
entran PDF y Word de verdad (no un ejecutable renombrado), y abrir uno queda
en la auditoría.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.core.models import AuditLog
from apps.organizacion.models import DocumentoInstitucional
from apps.organizacion.tests.test_organigrama import _cuenta

URL = "/api/v1/organizacion/documentos/"
#: Quien gestiona los códigos: los tres permisos de «Gestionar documentos».
GESTION = ("codigos.publicar", "codigos.acuerdo", "codigos.ver_aceptaciones")
CONFIDENCIALIDAD = "/api/v1/organizacion/confidencialidad/"
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest.fixture(autouse=True)
def _medios(tmp_path):
    with override_settings(MEDIA_ROOT=tmp_path):
        yield


def _pdf(nombre="Código de conducta 2026.pdf", contenido=PDF):
    return SimpleUploadedFile(nombre, contenido, content_type="application/pdf")


def _publicar(cliente, **extra):
    datos = {"titulo": "Código de conducta", "categoria": "conducta", "archivo": _pdf(), **extra}
    return cliente.post(URL, datos, format="multipart")


def test_se_publica_un_pdf_y_toda_persona_lo_lee(db):
    _, rrhh = _cuenta("talia", *GESTION)
    respuesta = _publicar(rrhh, version="V2", vigente_desde="2026-01-15")
    assert respuesta.status_code == 201, respuesta.data
    datos = respuesta.json()
    assert datos["es_pdf"] is True
    assert datos["nombre_original"] == "Código de conducta 2026.pdf"
    assert datos["categoria_display"] == "Código de conducta"
    assert "archivo" not in datos  # nunca se expone la ruta en el servidor

    # Una persona sin ningún permiso lo ve y, aceptado el acuerdo, lo abre.
    _, empleado = _cuenta("ema")
    lista = empleado.get(URL).json()
    assert [d["titulo"] for d in lista] == ["Código de conducta"]
    empleado.post(CONFIDENCIALIDAD + "aceptar/")
    archivo = empleado.get(f"{URL}{datos['id']}/archivo/")
    assert archivo.status_code == 200
    assert archivo["Content-Type"] == "application/pdf"
    assert archivo["X-Content-Type-Options"] == "nosniff"
    assert b"".join(archivo.streaming_content).startswith(b"%PDF-")
    assert AuditLog.objects.filter(action="institucional.documento.abierto").exists()


def test_sin_permiso_no_se_publica_ni_se_borra(db):
    _, rrhh = _cuenta("talia", *GESTION)
    documento = _publicar(rrhh).json()
    _, empleado = _cuenta("ema")
    assert _publicar(empleado).status_code == 403
    assert empleado.delete(f"{URL}{documento['id']}/").status_code == 403
    respuesta = empleado.patch(f"{URL}{documento['id']}/", {"titulo": "X"}, format="multipart")
    assert respuesta.status_code == 403


def test_solo_entran_pdf_y_word_de_verdad(db):
    _, rrhh = _cuenta("talia", *GESTION)
    renombrado = _pdf("reglamento.pdf", b"MZ\x90\x00 ejecutable")
    respuesta = _publicar(rrhh, archivo=renombrado)
    assert respuesta.status_code == 400
    assert "no corresponde" in str(respuesta.data)
    imagen = SimpleUploadedFile("foto.png", b"\x89PNG\r\n\x1a\n...", content_type="image/png")
    assert _publicar(rrhh, archivo=imagen).status_code == 400
    sin_archivo = rrhh.post(URL, {"titulo": "X", "categoria": "otro"}, format="multipart")
    assert sin_archivo.status_code == 400


def test_lo_retirado_no_lo_ve_el_personal_y_borrar_quita_el_archivo(db):
    _, rrhh = _cuenta("talia", *GESTION)
    documento = _publicar(rrhh).json()
    rrhh.patch(f"{URL}{documento['id']}/", {"activo": "false"}, format="multipart")

    _, empleado = _cuenta("ema")
    empleado.post(CONFIDENCIALIDAD + "aceptar/")
    assert empleado.get(URL).json() == []
    assert empleado.get(f"{URL}{documento['id']}/archivo/").status_code == 404
    assert len(rrhh.get(URL).json()) == 1  # quien gestiona sí lo ve

    guardado = DocumentoInstitucional.objects.get(pk=documento["id"])
    ruta = guardado.archivo.path
    assert rrhh.delete(f"{URL}{documento['id']}/").status_code == 204
    import os

    assert not os.path.exists(ruta)


def test_uno_solo_se_abre_primero(db):
    """Marcar un documento como predeterminado desmarca al anterior."""
    _, rrhh = _cuenta("talia", *GESTION)
    primero = _publicar(rrhh, predeterminado="true").json()
    assert primero["predeterminado"] is True
    segundo = _publicar(rrhh, titulo="Reglamento", categoria="disciplinario").json()
    assert segundo["predeterminado"] is False

    rrhh.patch(f"{URL}{segundo['id']}/", {"predeterminado": "true"}, format="multipart")
    marcados = {d["titulo"]: d["predeterminado"] for d in rrhh.get(URL).json()}
    assert marcados == {"Código de conducta": False, "Reglamento": True}


# --- Acuerdo de confidencialidad -------------------------------------------------------


def test_sin_aceptar_el_acuerdo_no_se_entrega_el_documento(db):
    _, rrhh = _cuenta("talia", *GESTION)
    documento = _publicar(rrhh).json()
    _, empleado = _cuenta("ema")

    estado = empleado.get(CONFIDENCIALIDAD).json()
    assert estado["aceptado"] is False
    assert estado["titulo"] == "Acuerdo de confidencialidad"
    archivo = empleado.get(f"{URL}{documento['id']}/archivo/")
    assert archivo.status_code == 403
    assert "acuerdo_pendiente" in str(archivo.content)

    aceptado = empleado.post(CONFIDENCIALIDAD + "aceptar/").json()
    assert aceptado["aceptado"] is True and aceptado["aceptado_en"]
    assert empleado.get(f"{URL}{documento['id']}/archivo/").status_code == 200
    assert AuditLog.objects.filter(action="institucional.confidencialidad.aceptada").exists()


def test_se_acepta_una_vez_hasta_que_cambian_los_documentos(db):
    from apps.organizacion.models import AceptacionConfidencialidad

    _, rrhh = _cuenta("talia", *GESTION)
    documento = _publicar(rrhh).json()
    _, empleado = _cuenta("ema")
    empleado.post(CONFIDENCIALIDAD + "aceptar/")
    empleado.post(CONFIDENCIALIDAD + "aceptar/")  # aceptar dos veces no duplica
    assert AceptacionConfidencialidad.objects.count() == 1
    assert empleado.get(CONFIDENCIALIDAD).json()["aceptado"] is True

    # Agregar, modificar o borrar cualquier documento lo vuelve a pedir.
    for cambio in (
        lambda: _publicar(rrhh, titulo="Reglamento", categoria="disciplinario"),
        lambda: rrhh.patch(f"{URL}{documento['id']}/", {"version": "V3"}, format="multipart"),
        lambda: rrhh.delete(f"{URL}{documento['id']}/"),
    ):
        cambio()
        estado = empleado.get(CONFIDENCIALIDAD).json()
        assert estado["aceptado"] is False
        assert estado["aceptado_antes_en"]  # se le dice que ya había aceptado
        empleado.post(CONFIDENCIALIDAD + "aceptar/")

    # Cada aceptación queda guardada, con su fecha.
    assert AceptacionConfidencialidad.objects.count() == 4


def test_el_titulo_y_el_texto_se_configuran_con_permiso(db):
    _, rrhh = _cuenta("talia", *GESTION)
    _, empleado = _cuenta("ema")
    nuevo = {"titulo": "Compromiso de reserva", "texto": "No compartir."}
    assert empleado.put(CONFIDENCIALIDAD, nuevo, format="json").status_code == 403
    assert rrhh.put(CONFIDENCIALIDAD, nuevo, format="json").status_code == 200
    estado = empleado.get(CONFIDENCIALIDAD).json()
    assert (estado["titulo"], estado["texto"]) == ("Compromiso de reserva", "No compartir.")

    empleado.post(CONFIDENCIALIDAD + "aceptar/")
    aceptaciones = rrhh.get(CONFIDENCIALIDAD + "aceptaciones/").json()
    assert [a["persona"] for a in aceptaciones] == ["Ema"]
    assert aceptaciones[0]["vigente"] is True
    assert empleado.get(CONFIDENCIALIDAD + "aceptaciones/").status_code == 403


def test_cada_pestana_de_la_gestion_pide_su_permiso(db):
    """Publicar, configurar el acuerdo y ver las aceptaciones se otorgan por
    separado."""
    _, publica = _cuenta("pablo", "codigos.publicar")
    _, acuerdo = _cuenta("ana", "codigos.acuerdo")
    _, auditora = _cuenta("aida", "codigos.ver_aceptaciones")
    texto = {"titulo": "Reserva", "texto": "No compartir."}

    assert _publicar(publica).status_code == 201
    assert publica.put(CONFIDENCIALIDAD, texto, format="json").status_code == 403
    assert publica.get(CONFIDENCIALIDAD + "aceptaciones/").status_code == 403

    assert _publicar(acuerdo).status_code == 403
    assert acuerdo.put(CONFIDENCIALIDAD, texto, format="json").status_code == 200

    assert _publicar(auditora).status_code == 403
    assert auditora.get(CONFIDENCIALIDAD + "aceptaciones/").status_code == 200
