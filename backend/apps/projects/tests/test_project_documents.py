"""Documentos, portado de Nexo (`test_project_documents.py`) y extendido con
lo propio de la intranet: el documento es un **archivo** (no base64 en la
base), validado como un adjunto, y se abre por una ruta protegida que lo
muestra dentro del sistema.

Adaptaciones de las pruebas de Nexo: el contenido es un PDF real (se valida
la firma); el detalle ya no trae `file_data` sino `file_url`."""

import base64
import io
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.projects.models import ProjectDocument, ProjectHistory, ProjectHistoryEvent
from apps.projects.services import DocumentService, load_base64_file

from .conftest import PDF_B64, PDF_BYTES, PNG_BYTES, client_for, create_project

pytestmark = pytest.mark.django_db


def _upload_document(*, actor, project, **overrides) -> dict:
    payload = {"file_name": "acta.pdf", "file_data": PDF_B64, "category": "PDF"}
    payload.update(overrides)
    response = client_for(actor).post(
        f"/api/v1/projects/{project.id}/documents/", payload, format="json"
    )
    assert response.status_code == 201, response.data
    return response.data


def _content(response) -> bytes:
    return b"".join(response.streaming_content)


# --- Subida (base64, contrato de Nexo) ---------------------------------------------


def test_participant_uploads_document(manager_level2, assistant_level1):
    project = create_project(
        creator=manager_level2, responsible=manager_level2, participant_ids=[assistant_level1.id]
    )
    document = _upload_document(actor=assistant_level1, project=project)
    assert document["file_name"] == "acta.pdf"
    assert document["version"] == 1
    assert document["mime_type"] == "application/pdf"
    assert document["viewable"] is True
    assert "file_data" not in document
    assert ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.DOCUMENTO_AGREGADO
    ).exists()


def test_non_participant_cannot_upload_document(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "a.pdf", "file_data": PDF_B64},
        format="json",
    )
    assert response.status_code == 404


def test_missing_required_fields_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/", {"file_name": "a.pdf"}, format="json"
    )
    assert response.status_code == 400


def test_oversized_file_returns_413(manager_level2, monkeypatch):
    from apps.projects import views as views_module

    monkeypatch.setattr(views_module, "MAX_BASE64_LENGTH", 10)
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "grande.pdf", "file_data": "a" * 11},
        format="json",
    )
    assert response.status_code == 413
    assert response.data["error"]["code"] == "file_too_large"
    assert not ProjectDocument.objects.filter(project=project).exists()


def test_versioning_with_valid_previous_version(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    first = _upload_document(actor=manager_level2, project=project, file_name="v1.pdf")
    second = _upload_document(
        actor=manager_level2, project=project, file_name="v2.pdf", previous_version_id=first["id"]
    )
    assert second["version"] == 2
    assert second["previous_version_id"] == first["id"]


def test_versioning_with_invalid_previous_version_returns_400(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "v2.pdf", "file_data": PDF_B64, "previous_version_id": 999999},
        format="json",
    )
    assert response.status_code == 400


def test_previous_version_from_another_project_returns_400(manager_level2):
    project_a = create_project(creator=manager_level2, responsible=manager_level2)
    project_b = create_project(
        creator=manager_level2, responsible=manager_level2, name="Otro proyecto"
    )
    first = _upload_document(actor=manager_level2, project=project_a)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project_b.id}/documents/",
        {"file_name": "v2.pdf", "file_data": PDF_B64, "previous_version_id": first["id"]},
        format="json",
    )
    assert response.status_code == 400


def test_history_description_includes_version_suffix(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    first = _upload_document(actor=manager_level2, project=project, file_name="v1.pdf")
    _upload_document(
        actor=manager_level2, project=project, file_name="v2.pdf", previous_version_id=first["id"]
    )
    entries = ProjectHistory.objects.filter(
        project=project, event=ProjectHistoryEvent.DOCUMENTO_AGREGADO
    ).order_by("created_at", "id")
    assert "(v2)" in entries[1].description
    assert "(v" not in entries[0].description


# --- Listado ---------------------------------------------------------------------


def test_list_documents_excludes_file_data(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    _upload_document(actor=manager_level2, project=project)
    response = client_for(manager_level2).get(f"/api/v1/projects/{project.id}/documents/")
    assert response.status_code == 200
    assert "file_data" not in response.data[0]
    assert response.data[0]["file_url"].endswith("/file/")


def test_list_documents_hidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    response = client_for(stranger).get(f"/api/v1/projects/{project.id}/documents/")
    assert response.status_code == 404


# --- Detalle -----------------------------------------------------------------------


def test_document_detail_points_to_the_file(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    document = _upload_document(actor=manager_level2, project=project)
    response = client_for(manager_level2).get(
        f"/api/v1/projects/{project.id}/documents/{document['id']}/"
    )
    assert response.status_code == 200
    assert response.data["file_url"] == (f"/projects/{project.id}/documents/{document['id']}/file/")


def test_document_detail_404_for_wrong_project(manager_level2):
    project_a = create_project(creator=manager_level2, responsible=manager_level2)
    project_b = create_project(
        creator=manager_level2, responsible=manager_level2, name="Otro proyecto"
    )
    document = _upload_document(actor=manager_level2, project=project_a)
    response = client_for(manager_level2).get(
        f"/api/v1/projects/{project_b.id}/documents/{document['id']}/"
    )
    assert response.status_code == 404


def test_document_detail_hidden_for_non_viewer(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    document = _upload_document(actor=manager_level2, project=project)
    response = client_for(stranger).get(
        f"/api/v1/projects/{project.id}/documents/{document['id']}/"
    )
    assert response.status_code == 404


# --- Vínculo con actividad ---------------------------------------------------------


def test_document_links_to_valid_activity(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    activity_response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/activities/",
        {
            "description": "Reunión de seguimiento con el equipo",
            "start_time": "09:00",
            "end_time": "10:00",
        },
        format="json",
    )
    assert activity_response.status_code == 201
    document = _upload_document(
        actor=manager_level2, project=project, activity=activity_response.data["id"]
    )
    assert document["activity_id"] == activity_response.data["id"]


def test_document_with_activity_from_another_project_returns_400(manager_level2):
    project_a = create_project(creator=manager_level2, responsible=manager_level2)
    project_b = create_project(
        creator=manager_level2, responsible=manager_level2, name="Otro proyecto"
    )
    activity_response = client_for(manager_level2).post(
        f"/api/v1/projects/{project_b.id}/activities/",
        {
            "description": "Reunión de seguimiento con el equipo",
            "start_time": "09:00",
            "end_time": "10:00",
        },
        format="json",
    )
    assert activity_response.status_code == 201
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project_a.id}/documents/",
        {"file_name": "acta.pdf", "file_data": PDF_B64, "activity": activity_response.data["id"]},
        format="json",
    )
    assert response.status_code == 400


# --- Lo propio de la intranet: archivo, validación y visor -------------------------


def test_document_is_stored_as_a_file_not_in_the_database(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    document = _upload_document(actor=manager_level2, project=project)
    stored = ProjectDocument.objects.get(pk=document["id"])
    assert stored.file.name.startswith(f"proyectos_gh/{project.id}/")
    assert not stored.file.name.endswith("acta.pdf")  # nombre en disco: uuid
    with stored.file.open("rb") as fichero:
        assert fichero.read() == PDF_BYTES
    assert stored.file_size == len(PDF_BYTES)


def test_multipart_upload(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    archivo = SimpleUploadedFile("Acta de reunión.pdf", PDF_BYTES, content_type="application/pdf")
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file": archivo, "category": "ACTA"},
        format="multipart",
    )
    assert response.status_code == 201, response.data
    assert response.data["file_name"] == "Acta de reunión.pdf"
    assert response.data["mime_type"] == "application/pdf"
    assert response.data["viewable"] is True
    assert response.data["viewer"] == "pdf"


# --- Formatos (05/11/2026): solo PDF, Word, Excel y PowerPoint ---------------------


def _ooxml(carpeta: str) -> bytes:
    """Un OOXML mínimo: `[Content_Types].xml` y la carpeta de su aplicación."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as contenedor:
        contenedor.writestr("[Content_Types].xml", "<Types/>")
        contenedor.writestr(f"{carpeta}document.xml", "<doc/>")
    return buffer.getvalue()


OLE_BYTES = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64


def _multipart(actor, project, nombre: str, contenido: bytes):
    return client_for(actor).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file": SimpleUploadedFile(nombre, contenido)},
        format="multipart",
    )


@pytest.mark.parametrize(
    ("nombre", "contenido", "mime", "visor"),
    [
        ("Informe de gestión.pdf", PDF_BYTES, "application/pdf", "pdf"),
        (
            "Presentación de inducción.pptx",
            _ooxml("ppt/"),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "presentacion",
        ),
        ("Presentación antigua.ppt", OLE_BYTES, "application/vnd.ms-powerpoint", None),
        (
            "Política de vacaciones.docx",
            _ooxml("word/"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            None,
        ),
        ("Política antigua.doc", OLE_BYTES, "application/msword", None),
        (
            "Nómina año 2026.xlsx",
            _ooxml("xl/"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            None,
        ),
        ("Nómina antigua.xls", OLE_BYTES, "application/vnd.ms-excel", None),
    ],
)
def test_office_formats_are_accepted_with_their_viewer(
    manager_level2, nombre, contenido, mime, visor
):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _multipart(manager_level2, project, nombre, contenido)
    assert response.status_code == 201, response.data
    assert response.data["mime_type"] == mime
    assert response.data["viewer"] == visor
    assert response.data["viewable"] is (visor is not None)


@pytest.mark.parametrize(
    ("nombre", "contenido"),
    [
        ("foto de reunión.png", PNG_BYTES),
        ("foto.jpg", b"\xff\xd8\xff\xe0" + b"\x00" * 16),
        ("foto.webp", b"RIFF" + b"\x00" * 16),
    ],
)
def test_images_are_no_longer_accepted(manager_level2, nombre, contenido):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _multipart(manager_level2, project, nombre, contenido)
    assert response.status_code == 400
    assert response.data["error"]["code"] == "validation_error"
    assert "file" in response.data["error"]["details"]
    assert not ProjectDocument.objects.exists()


def test_images_are_still_accepted_by_the_other_modules():
    """La lista de Proyectos es propia: el validador general no cambia."""
    from apps.adjuntos.validators import validar_archivo

    assert validar_archivo(SimpleUploadedFile("equipo.png", PNG_BYTES)) == ".png"


@pytest.mark.parametrize(
    ("nombre", "contenido"),
    [
        # Un ZIP cualquiera renombrado: tiene la firma, pero no es un OOXML.
        ("Presentación.pptx", b"PK\x03\x04" + b"\x00" * 40),
        # Un OOXML de Word renombrado a PowerPoint.
        ("Presentación.pptx", _ooxml("word/")),
        # Un PDF renombrado a .doc (no es OLE).
        ("Política.doc", PDF_BYTES),
        # Un OLE renombrado a .docx (no es ZIP).
        ("Política.docx", OLE_BYTES),
    ],
)
def test_content_must_match_the_office_format(manager_level2, nombre, contenido):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = _multipart(manager_level2, project, nombre, contenido)
    assert response.status_code == 400
    assert "file" in response.data["error"]["details"]
    assert not ProjectDocument.objects.exists()


def test_presentation_is_served_for_the_slide_viewer(manager_level2):
    """La .pptx se entrega con su tipo para que el visor de presentaciones la
    dibuje (la pide como blob, como en Capacitación)."""
    project = create_project(creator=manager_level2, responsible=manager_level2)
    contenido = _ooxml("ppt/")
    document = _multipart(manager_level2, project, "Inducción.pptx", contenido).data
    response = client_for(manager_level2).get(
        f"/api/v1/projects/{project.id}/documents/{document['id']}/file/"
    )
    assert response.status_code == 200
    assert response["Content-Type"] == (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    assert response["X-Content-Type-Options"] == "nosniff"
    assert _content(response) == contenido


def test_word_and_excel_are_downloaded(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    for nombre, carpeta in (("Política.docx", "word/"), ("Nómina.xlsx", "xl/")):
        document = _multipart(manager_level2, project, nombre, _ooxml(carpeta)).data
        response = client_for(manager_level2).get(
            f"/api/v1/projects/{project.id}/documents/{document['id']}/file/"
        )
        assert response.status_code == 200
        assert response["Content-Disposition"].startswith("attachment;")


def test_pdf_is_served_inline_for_the_internal_viewer(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    document = _upload_document(actor=manager_level2, project=project, file_name="Acta reunión.pdf")
    response = client_for(manager_level2).get(
        f"/api/v1/projects/{project.id}/documents/{document['id']}/file/"
    )
    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"].startswith("inline;")
    assert "Acta%20reuni%C3%B3n.pdf" in response["Content-Disposition"]
    assert response["X-Content-Type-Options"] == "nosniff"
    assert _content(response) == PDF_BYTES


def test_download_is_explicit(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    document = _upload_document(actor=manager_level2, project=project)
    response = client_for(manager_level2).get(
        f"/api/v1/projects/{project.id}/documents/{document['id']}/file/?download=1"
    )
    assert response["Content-Disposition"].startswith("attachment;")


def test_file_is_protected_like_the_project(manager_level2, assistant_level1, stranger):
    project = create_project(creator=manager_level2, responsible=assistant_level1)
    document = _upload_document(actor=manager_level2, project=project)
    response = client_for(stranger).get(
        f"/api/v1/projects/{project.id}/documents/{document['id']}/file/"
    )
    assert response.status_code == 404


def test_renamed_executable_is_rejected(manager_level2):
    """La firma del contenido manda, no la extensión."""
    project = create_project(creator=manager_level2, responsible=manager_level2)
    falso = base64.b64encode(b"MZ\x90\x00 ejecutable").decode()
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "acta.pdf", "file_data": falso},
        format="json",
    )
    assert response.status_code == 400
    assert "file" in response.data["error"]["details"]
    assert not ProjectDocument.objects.exists()


def test_disallowed_extension_is_rejected(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "pagina.html", "file_data": base64.b64encode(b"<html></html>").decode()},
        format="json",
    )
    assert response.status_code == 400


def test_invalid_base64_is_rejected(manager_level2):
    project = create_project(creator=manager_level2, responsible=manager_level2)
    response = client_for(manager_level2).post(
        f"/api/v1/projects/{project.id}/documents/",
        {"file_name": "acta.pdf", "file_data": "esto no es base64!!"},
        format="json",
    )
    assert response.status_code == 400
    assert "file_data" in response.data["error"]["details"]


def test_load_base64_file_accepts_data_url_for_the_nexo_migration():
    contenido = load_base64_file("acta.pdf", f"data:application/pdf;base64,{PDF_B64}")
    assert contenido.read() == PDF_BYTES
    assert contenido.name == "acta.pdf"


def test_migration_helper_saves_base64_without_a_request(manager_level2):
    """La migración de datos de Nexo usará `load_base64_file` +
    `upload_document(check_access=False)`."""
    project = create_project(creator=manager_level2, responsible=manager_level2)
    document = DocumentService.upload_document(
        actor=manager_level2,
        project=project,
        file=load_base64_file("migrado.pdf", PDF_B64),
        file_name="migrado.pdf",
        check_access=False,
    )
    assert document.file_size == len(PDF_BYTES)
    assert document.mime_type == "application/pdf"


def test_hard_delete_removes_the_files(manager_level2, settings):
    from pathlib import Path

    project = create_project(creator=manager_level2, responsible=manager_level2)
    document = _upload_document(actor=manager_level2, project=project)
    ruta = Path(settings.MEDIA_ROOT) / ProjectDocument.objects.get(pk=document["id"]).file.name
    assert ruta.exists()
    client = client_for(manager_level2)
    client.delete(f"/api/v1/projects/{project.id}/")
    response = client.delete(f"/api/v1/projects/{project.id}/permanent/")
    assert response.status_code == 200
    assert not ruta.exists()
