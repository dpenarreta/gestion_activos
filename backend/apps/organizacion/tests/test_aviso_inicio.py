"""El aviso al iniciar sesión.

Lo que se protege (19/10/2026): todos lo leen (se muestra al entrar);
cambiarlo pide `configuracion.aviso_inicio`; encendido necesita título; la
imagen es opcional, se valida, se reemplaza y se quita; cada cambio sube la
versión (quien ya lo cerró lo vuelve a ver si cambió).
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.organizacion.tests.test_organigrama import _cuenta

URL = "/api/v1/organizacion/aviso-inicio/"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _medios(tmp_path):
    with override_settings(MEDIA_ROOT=tmp_path):
        yield


def _guardar(cliente, **datos):
    return cliente.put(URL, datos, format="multipart")


def test_todos_lo_leen_y_solo_con_permiso_se_cambia(db):
    _, admin = _cuenta("ines", "configuracion.aviso_inicio")
    _, empleado = _cuenta("ema")
    assert empleado.get(URL).json()["activo"] is False
    assert _guardar(empleado, activo="true", titulo="X").status_code == 403

    imagen = SimpleUploadedFile("aviso.png", PNG, content_type="image/png")
    respuesta = _guardar(
        admin, activo="true", titulo="Mantenimiento", contenido="El sábado.", imagen=imagen
    )
    assert respuesta.status_code == 200, respuesta.data
    aviso = empleado.get(URL).json()
    assert aviso["activo"] is True
    assert (aviso["titulo"], aviso["contenido"]) == ("Mantenimiento", "El sábado.")
    assert aviso["tiene_imagen"] is True
    foto = empleado.get(URL + "imagen/")
    assert foto.status_code == 200 and foto["Content-Type"] == "image/png"


def test_encendido_necesita_titulo_y_la_imagen_se_valida(db):
    _, admin = _cuenta("ines", "configuracion.aviso_inicio")
    sin_titulo = _guardar(admin, activo="true", titulo="  ")
    assert sin_titulo.status_code == 400
    renombrada = SimpleUploadedFile("aviso.png", b"MZ ejecutable", content_type="image/png")
    assert _guardar(admin, titulo="X", imagen=renombrada).status_code == 400


def test_cada_cambio_sube_la_version_y_la_imagen_se_quita(db):
    _, admin = _cuenta("ines", "configuracion.aviso_inicio")
    imagen = SimpleUploadedFile("aviso.png", PNG, content_type="image/png")
    primera = _guardar(admin, activo="true", titulo="A", imagen=imagen).json()
    segunda = _guardar(admin, activo="true", titulo="B", quitar_imagen="true").json()
    assert segunda["version"] == primera["version"] + 1
    assert segunda["tiene_imagen"] is False
    assert admin.get(URL + "imagen/").status_code == 404
