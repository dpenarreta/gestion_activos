"""El carrusel de noticias de Inicio.

Lo que se protege (19/10/2026): toda persona ve solo las imágenes vigentes
hoy (entre su día de inicio y de fin); subir, editar, borrar y ajustar la
velocidad pide `noticias.gestionar`; solo entran imágenes de verdad.
"""

import datetime

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.organizacion.tests.test_organigrama import _cuenta

URL = "/api/v1/organizacion/noticias/"
CARRUSEL = "/api/v1/organizacion/carrusel/"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
HOY = datetime.date(2026, 10, 19)


@pytest.fixture(autouse=True)
def _medios_y_dia(tmp_path, monkeypatch):
    monkeypatch.setattr("apps.organizacion.noticias.hoy", lambda: HOY)
    with override_settings(MEDIA_ROOT=tmp_path):
        yield


def _imagen(nombre="evento.png", contenido=PNG):
    return SimpleUploadedFile(nombre, contenido, content_type="image/png")


def _subir(cliente, desde, hasta, **extra):
    datos = {
        "titulo": "Evento",
        "imagen": _imagen(),
        "publicar_desde": desde.isoformat(),
        "publicar_hasta": hasta.isoformat(),
        **extra,
    }
    return cliente.post(URL, datos, format="multipart")


def test_cada_persona_ve_solo_las_vigentes_hoy(db):
    _, th = _cuenta("tania", "noticias.gestionar")
    un_dia = datetime.timedelta(days=1)
    assert _subir(th, HOY - un_dia, HOY + un_dia, titulo="Vigente").status_code == 201
    assert _subir(th, HOY, HOY, titulo="Solo hoy").status_code == 201
    _subir(th, HOY + un_dia, HOY + 5 * un_dia, titulo="Programada")
    _subir(th, HOY - 5 * un_dia, HOY - un_dia, titulo="Vencida")

    _, empleado = _cuenta("ema")
    vistas = [n["titulo"] for n in empleado.get(URL).json()]
    assert sorted(vistas) == ["Solo hoy", "Vigente"]
    noticia = empleado.get(URL).json()[0]
    imagen = empleado.get(f"{URL}{noticia['id']}/imagen/")
    assert imagen.status_code == 200
    assert imagen["Content-Type"] == "image/png"

    # Quien gestiona ve todas, con su estado.
    estados = {n["titulo"]: n["estado"] for n in th.get(URL, {"todas": "1"}).json()}
    assert estados == {
        "Vigente": "publicada",
        "Solo hoy": "publicada",
        "Programada": "programada",
        "Vencida": "vencida",
    }


def test_las_fechas_y_la_imagen_se_validan(db):
    _, th = _cuenta("tania", "noticias.gestionar")
    al_reves = _subir(th, HOY, HOY - datetime.timedelta(days=1))
    assert al_reves.status_code == 400
    assert "anterior" in str(al_reves.data)
    renombrado = _subir(th, HOY, HOY, imagen=_imagen("foto.png", b"MZ ejecutable"))
    assert renombrado.status_code == 400
    pdf = _subir(th, HOY, HOY, imagen=_imagen("aviso.pdf", b"%PDF-1.4"))
    assert pdf.status_code == 400


def test_sin_permiso_no_se_publica_ni_se_ajusta(db):
    _, th = _cuenta("tania", "noticias.gestionar")
    noticia = _subir(th, HOY, HOY).json()
    _, empleado = _cuenta("ema")
    assert _subir(empleado, HOY, HOY).status_code == 403
    assert empleado.delete(f"{URL}{noticia['id']}/").status_code == 403
    assert empleado.put(CARRUSEL, {"segundos": 10}, format="json").status_code == 403
    assert empleado.get(CARRUSEL).json() == {"segundos": 6}


def test_se_borra_y_se_ajusta_la_velocidad(db):
    _, th = _cuenta("tania", "noticias.gestionar")
    vencida = _subir(th, HOY - datetime.timedelta(days=9), HOY - datetime.timedelta(days=2))
    # Una que ya no se muestra también se puede borrar.
    assert th.delete(f"{URL}{vencida.json()['id']}/").status_code == 204
    assert th.put(CARRUSEL, {"segundos": 1}, format="json").status_code == 400
    assert th.put(CARRUSEL, {"segundos": 4}, format="json").status_code == 400
    assert th.put(CARRUSEL, {"segundos": 10}, format="json").json() == {"segundos": 10}


def test_la_noticia_lleva_su_texto_alternativo(db):
    """Lo que dice la imagen, para quien no la ve (auditoría UX/UI,
    27/10/2026). Vacío: la imagen es decorativa."""
    _, th = _cuenta("tania", "noticias.gestionar")
    respuesta = _subir(
        th, HOY, HOY, texto_alternativo="Afiche: feria de salud, 20 al 24 de octubre"
    )
    assert respuesta.status_code == 201, respuesta.data
    _, empleado = _cuenta("ema")
    (noticia,) = empleado.get(URL).json()
    assert noticia["texto_alternativo"] == "Afiche: feria de salud, 20 al 24 de octubre"
    sin_texto = _subir(th, HOY, HOY, titulo="Otra")
    assert sin_texto.data["texto_alternativo"] == ""
