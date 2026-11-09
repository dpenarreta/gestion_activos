"""La base de conocimiento de Nova: subir (validación del PDF), extraer y
trocear, buscar (BM25 sin tildes), listar, abrir, eliminar y quién puede qué."""

import io
import os

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from reportlab.pdfgen import canvas

from apps.core.models import AuditLog
from apps.informes.tests.conftest import client_for, make_user
from apps.nova import conocimiento
from apps.nova.models import DocumentoConocimiento, FragmentoConocimiento

pytestmark = pytest.mark.django_db

URL = "/api/v1/nova/conocimiento/documentos/"


@pytest.fixture(autouse=True)
def _archivos(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


def pdf(*paginas: str) -> bytes:
    """Un PDF con una línea de texto por renglón de cada página."""
    salida = io.BytesIO()
    lienzo = canvas.Canvas(salida)
    for pagina in paginas:
        y = 800
        for linea in pagina.split("\n"):
            lienzo.drawString(40, y, linea)
            y -= 14
        lienzo.showPage()
    lienzo.save()
    return salida.getvalue()


def archivo(contenido: bytes, nombre="reglamento.pdf"):
    return SimpleUploadedFile(nombre, contenido, content_type="application/pdf")


def subir(usuario, contenido: bytes, nombre="reglamento.pdf", titulo=""):
    return client_for(usuario).post(
        URL, {"archivo": archivo(contenido, nombre), "titulo": titulo}, format="multipart"
    )


# ── Texto ───────────────────────────────────────────────────────────────────


def test_terminos_sin_tildes_ni_plurales():
    assert conocimiento.terminos("¿Cuántos DÍAS de Vacaciones tengo?") == ["dia", "vacacion"]


def test_trocear_con_solape():
    texto = " ".join(f"palabra{i}" for i in range(800))
    trozos = conocimiento.trocear(texto)
    assert len(trozos) > 1
    assert all(len(t) <= conocimiento.LARGO_FRAGMENTO for t in trozos)
    # El final de uno se repite al comienzo del siguiente.
    assert trozos[0].split()[-1] in trozos[1]
    # Ninguna palabra cortada.
    assert all(p.startswith("palabra") for t in trozos for p in t.split())


def test_buscar_ordena_y_aplica_el_umbral():
    documento = DocumentoConocimiento.objects.create(
        titulo="Reglamento", archivo="x.pdf", nombre_original="x.pdf", tamano_bytes=1
    )
    textos = [
        "Las vacaciones anuales son de quince días hábiles por año trabajado.",
        "El horario de trabajo es de ocho a diecisiete horas.",
        "Las vacaciones se solicitan con quince días de anticipación al jefe.",
        "Uso del parqueadero y normas de convivencia.",
    ]
    for orden, texto in enumerate(textos):
        FragmentoConocimiento.objects.create(
            empresa=documento.empresa,
            documento=documento,
            orden=orden,
            pagina=1,
            texto=texto,
            terminos=" ".join(conocimiento.terminos(texto)),
        )
    encontrados = conocimiento.buscar("¿Cuántos días de VACACIÓN anuales?")
    assert [e.texto for e in encontrados][:1] == [textos[0]]
    assert textos[3] not in [e.texto for e in encontrados]
    assert conocimiento.buscar("¿qué es esto?") == []
    assert conocimiento.buscar("criptomonedas") == []


# ── Subir ───────────────────────────────────────────────────────────────────


def test_subir_un_pdf_extrae_y_trocea(admin_gh):
    respuesta = subir(
        admin_gh,
        pdf("Reglamento interno\nLas vacaciones son de quince dias.", "Horario de 8 a 17."),
        titulo="Reglamento interno 2026",
    )
    assert respuesta.status_code == 201, respuesta.content
    datos = respuesta.json()
    assert datos["titulo"] == "Reglamento interno 2026"
    assert datos["paginas"] == 2 and datos["fragmentos"] == 2
    documento = DocumentoConocimiento.objects.get(pk=datos["id"])
    assert documento.archivo.name.startswith("nova/conocimiento/")
    assert documento.empresa_id is not None
    assert set(documento.fragmentos.values_list("empresa_id", flat=True)) == {documento.empresa_id}
    assert [f.pagina for f in documento.fragmentos.all()] == [1, 2]
    assert AuditLog.objects.filter(action="nova.conocimiento.subido").exists()


def test_sin_titulo_usa_el_nombre_del_archivo(admin_gh):
    respuesta = subir(admin_gh, pdf("Texto"), nombre="Politica de viaticos.pdf")
    assert respuesta.json()["titulo"] == "Politica de viaticos"


@pytest.mark.parametrize(
    ("contenido", "nombre", "mensaje"),
    [
        (b"MZ\x90\x00 ejecutable", "malo.pdf", "no es un PDF"),
        (pdf("Texto"), "reglamento.docx", "Solo se admiten"),
        (b"", "vacio.pdf", "vacío"),
        (b"%PDF-1.4\n basura sin estructura", "roto.pdf", "No se pudo leer"),
    ],
)
def test_rechaza_lo_que_no_es_un_pdf_valido(admin_gh, contenido, nombre, mensaje):
    respuesta = subir(admin_gh, contenido, nombre=nombre)
    assert respuesta.status_code == 400
    assert mensaje in respuesta.json()["error"]["message"]
    assert not DocumentoConocimiento.objects.exists()


def test_rechaza_un_pdf_sin_texto(admin_gh, tmp_path):
    respuesta = subir(admin_gh, pdf(""))
    assert respuesta.status_code == 400
    assert "texto seleccionable" in respuesta.json()["error"]["message"]
    # No queda un archivo huérfano.
    assert not list(tmp_path.rglob("*.pdf"))


def test_tope_de_tamano_configurable(admin_gh, settings):
    settings.NOVA_CONOCIMIENTO_TAMANO_MAXIMO_MB = 1
    grande = pdf("Texto") + b" " * (1024 * 1024)
    respuesta = subir(admin_gh, grande)
    assert respuesta.status_code == 400
    assert "el máximo es 1 MB" in respuesta.json()["error"]["message"]


# ── Permisos ────────────────────────────────────────────────────────────────


def test_quien_solo_ve_lista_y_abre_pero_no_gestiona(admin_gh, ana):
    documento_id = subir(admin_gh, pdf("Vacaciones de quince dias")).json()["id"]

    lista = client_for(ana).get(URL)
    assert lista.status_code == 200
    assert lista.json()["gestionar"] is False
    assert [d["id"] for d in lista.json()["resultados"]] == [documento_id]

    abierto = client_for(ana).get(f"{URL}{documento_id}/archivo/")
    assert abierto.status_code == 200
    assert abierto["Content-Type"] == "application/pdf"
    assert b"".join(abierto.streaming_content).startswith(b"%PDF-")

    assert subir(ana, pdf("Otro")).status_code == 403
    assert client_for(ana).delete(f"{URL}{documento_id}/").status_code == 403
    # Hallazgo de Nexo: los fragmentos no se listan solo con la sesión.
    assert client_for(ana).get(f"{URL}{documento_id}/fragmentos/").status_code == 403
    fragmentos = client_for(admin_gh).get(f"{URL}{documento_id}/fragmentos/")
    assert fragmentos.status_code == 200
    assert "quince" in fragmentos.json()["fragmentos"][0]["texto"]


def test_sin_permiso_no_ve_nada(admin_gh):
    documento_id = subir(admin_gh, pdf("Texto")).json()["id"]
    nadie = make_user("sinrol")
    assert client_for(nadie).get(URL).status_code == 403
    assert client_for(nadie).get(f"{URL}{documento_id}/archivo/").status_code == 403
    assert client_for(nadie).get(f"{URL}{documento_id}/fragmentos/").status_code == 403


def test_busqueda_en_el_listado_sin_tildes(admin_gh):
    subir(admin_gh, pdf("Texto"), titulo="Política de viáticos")
    subir(admin_gh, pdf("Texto"), titulo="Reglamento interno")
    lista = client_for(admin_gh).get(URL, {"q": "politica"}).json()["resultados"]
    assert [d["titulo"] for d in lista] == ["Política de viáticos"]


def test_eliminar_borra_archivo_y_fragmentos(admin_gh):
    documento_id = subir(admin_gh, pdf("Texto")).json()["id"]
    documento = DocumentoConocimiento.objects.get(pk=documento_id)
    ruta = documento.archivo.path
    respuesta = client_for(admin_gh).delete(f"{URL}{documento_id}/")
    assert respuesta.status_code == 204
    assert not DocumentoConocimiento.objects.filter(pk=documento_id).exists()
    assert not FragmentoConocimiento.objects.filter(documento_id=documento_id).exists()
    assert not os.path.exists(ruta)
    assert AuditLog.objects.filter(action="nova.conocimiento.eliminado").exists()


def test_cada_empresa_ve_sus_documentos(admin_gh):
    from apps.empresas.contexto import usando_empresa
    from apps.empresas.models import Empresa

    subir(admin_gh, pdf("Texto"), titulo="De esta empresa")
    otra = Empresa.objects.create(nombre="Otra empresa de prueba", codigo="OTRA")
    with usando_empresa(otra):
        assert not DocumentoConocimiento.objects.exists()
        assert conocimiento.buscar("texto") == []
