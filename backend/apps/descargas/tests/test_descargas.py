"""Registro de descargas (26/10/2026).

Lo que se protege, y cómo se intenta saltarlo:

- Toda persona registra lo que guarda; quién, la IP, la fecha y la hora salen
  de la petición, no de lo que mande la pantalla.
- La copia es exacta (misma huella) y una por archivo, aunque se descargue
  muchas veces.
- Lo que entregó el servidor queda comprobado; lo que no, queda como no
  comprobado pero con su copia.
- Los roles de pagos no se copian, y eso lo decide el servidor: la pantalla no
  puede pedir «sin copia» para otro archivo.
- Ver el reporte y abrir las copias pide `auditoria.descargas`.
- El resumen diario llega una vez, desde las 07:00, a quien tiene el permiso.
"""

import hashlib
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from apps.descargas import services
from apps.descargas.models import ArchivoServido, CopiaArchivo, Descarga, ResumenDescargas
from apps.notificaciones.models import Notificacion
from apps.organizacion.tests.test_carga_personas import _cuenta

URL = "/api/v1/descargas/"


@pytest.fixture(autouse=True)
def _media(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)


def _guardar(cliente, contenido=b"%PDF-1.4 hola", nombre="acta.pdf", **extra):
    datos = {
        "nombre": nombre,
        "archivo": SimpleUploadedFile(nombre, contenido, content_type="application/pdf"),
        "tipo": "application/pdf",
        "pantalla": "/admin/activos/3",
        **extra,
    }
    return cliente.post(URL, datos, format="multipart", REMOTE_ADDR="10.0.2.80")


def test_cualquier_persona_registra_lo_que_guarda_con_su_copia(db):
    ana, cliente = _cuenta("ana")
    respuesta = _guardar(cliente)
    assert respuesta.status_code == 201
    d = Descarga.objects.get()
    assert d.usuario == ana and d.ip == "10.0.2.80" and d.nombre == "acta.pdf"
    assert d.sha256 == hashlib.sha256(b"%PDF-1.4 hola").hexdigest()
    assert d.modulo == "Gestión de Activos"
    assert not d.verificada  # el servidor no se lo entregó
    assert d.copia.archivo.read() == b"%PDF-1.4 hola"

    # El mismo archivo otra vez: un registro más, una sola copia.
    _guardar(cliente)
    assert Descarga.objects.count() == 2 and CopiaArchivo.objects.count() == 1


def test_lo_que_entrego_el_servidor_queda_comprobado(db):
    """El middleware anota la huella de cada archivo que sale de la API."""
    ana, cliente = _cuenta("ana", "auditoria.exportar", "auditoria.ver")
    servido = cliente.get("/api/v1/admin/audit-logs/export/")
    assert servido.status_code == 200
    contenido = b"".join(servido.streaming_content) if servido.streaming else servido.content
    anotado = ArchivoServido.objects.get(usuario=ana)
    assert anotado.sha256 == hashlib.sha256(contenido).hexdigest()

    _guardar(cliente, contenido, nombre="auditoria.csv", pantalla="/admin/auditoria")
    d = Descarga.objects.get()
    assert d.verificada and d.origen == anotado.ruta
    assert d.modulo == "Auditoría"


@override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True)
def test_el_rol_de_pagos_se_registra_sin_copia(db):
    from apps.nomina.tests.test_rol_pagos import CLAVE, _consultar

    ana, cliente = _cuenta("ana", "roles_pago.consultar")
    ana.codigo_empleado = "100"
    ana.set_password(CLAVE)
    ana.save()
    pdf = _consultar(cliente)
    assert pdf.status_code == 200

    _guardar(
        cliente,
        pdf.content,
        nombre="rol-de-pagos-2026-09.pdf",
        pantalla="/admin/institucional/rol-pagos",
    )
    d = Descarga.objects.get()
    assert d.copia is None and "Rol de pagos" in d.sin_copia
    assert d.verificada and d.modulo == "Rol de pagos"
    assert d.referencia["anio"] == 2026 and d.referencia["mes"] == 9
    assert d.referencia["codigo"] == "100"
    assert CopiaArchivo.objects.count() == 0


def test_la_pantalla_no_puede_pedir_sin_copia(db):
    _, cliente = _cuenta("ana")
    _guardar(cliente, sin_copia="Rol de pagos", referencia='{"sin_copia": "x"}')
    d = Descarga.objects.get()
    assert d.copia is not None and d.sin_copia == "" and d.referencia == {}


def test_sin_archivo_queda_el_registro_sin_copia(db):
    _, cliente = _cuenta("ana")
    respuesta = cliente.post(
        URL, {"nombre": "grande.zip", "tamano": 90_000_000}, format="multipart"
    )
    assert respuesta.status_code == 201
    d = Descarga.objects.get()
    assert d.copia is None and d.sin_copia == services.GRANDE and d.tamano == 90_000_000


def test_el_reporte_y_las_copias_piden_el_permiso(db):
    _, ana = _cuenta("ana")
    _guardar(ana, b"contenido exacto", nombre="informe.xlsx")
    d = Descarga.objects.get()
    assert ana.get(URL).status_code == 403
    assert ana.get(f"{URL}{d.id}/copia/").status_code == 403

    _, auditor = _cuenta("auditor", "auditoria.descargas")
    datos = auditor.get(URL, {"q": "ana"}).json()
    (fila,) = datos["results"]
    assert fila["usuario"]["nombre"] == "Ana Prueba"
    assert fila["ip"] and fila["momento"]["fecha"] and fila["tiene_copia"]
    copia = auditor.get(f"{URL}{d.id}/copia/")
    assert copia.status_code == 200
    assert b"".join(copia.streaming_content) == b"contenido exacto"
    assert auditor.get(URL, {"q": "nadie"}).json()["results"] == []
    assert auditor.get(f"{URL}exportar/").status_code == 200
    assert auditor.get(f"{URL}modulos/").json() == ["Gestión de Activos"]


def test_el_resumen_diario_llega_una_vez_desde_las_siete(db):
    ana, cliente = _cuenta("ana")
    auditor, _ = _cuenta("auditor", "auditoria.descargas")
    _guardar(cliente)
    Descarga.objects.update(created_at=timezone.now() - timedelta(days=1))
    manana = timezone.localtime().replace(hour=6, minute=0)
    assert services.resumen_diario(manana) == 0

    a_las_ocho = manana.replace(hour=8)
    assert services.resumen_diario(a_las_ocho) == 1
    assert services.resumen_diario(a_las_ocho) == 0  # ya se avisó
    aviso = Notificacion.objects.get(usuario=auditor)
    assert aviso.titulo.endswith(": 1") and "Ana Prueba (1)" in aviso.resumen
    assert aviso.enlace.startswith("/admin/auditoria?modulo=descargas&desde=")
    assert not Notificacion.objects.filter(usuario=ana).exists()
    assert ResumenDescargas.objects.count() == 1


def test_limpiar_borra_lo_servido_viejo_y_las_copias_de_un_anio(db):
    _, cliente = _cuenta("ana")
    _guardar(cliente)
    ArchivoServido.objects.create(ruta="/api/v1/x/", sha256="a" * 64)
    ArchivoServido.objects.update(creado=timezone.now() - timedelta(days=3))
    CopiaArchivo.objects.update(ultima_vez=timezone.now() - timedelta(days=400))

    assert services.limpiar() == {"servidos": 1, "copias": 1}
    d = Descarga.objects.get()
    assert d.copia is None and "un año" in d.sin_copia
