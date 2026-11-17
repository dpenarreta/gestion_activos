"""El estado «En reunión» desde el calendario de Google (17/11/2026).

Se simulan las respuestas de Google: nunca se llama a la red en las pruebas.
"""

import datetime
from unittest import mock
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth.models import Permission
from django.utils import timezone
from rest_framework.test import APIClient

from apps.chat import calendario
from apps.chat.models import CalendarioGoogle, EstadoChat
from apps.users.models import User

pytestmark = pytest.mark.django_db
URL = "/api/v1/chat/calendario/"


@pytest.fixture(autouse=True)
def google(settings):
    settings.GOOGLE_CALENDAR_CLIENT_ID = "cliente-de-prueba"
    settings.GOOGLE_CALENDAR_CLIENT_SECRET = "secreto-de-prueba"
    settings.GOOGLE_CALENDAR_REDIRECT_URI = "https://intranet.test/api/v1/chat/calendario/callback/"
    settings.FRONTEND_URL = "https://intranet.test"


@pytest.fixture
def ana():
    usuario = User.objects.create_user(
        username="ana", email="ana@grupolaar.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="permissions", codename="chat.calendario_google"
        )
    )
    return User.objects.get(pk=usuario.pk)


def _respuesta(codigo, datos=None, texto=""):
    r = mock.Mock(status_code=codigo, text=texto)
    r.json.return_value = datos or {}
    return r


def test_conectar_pide_solo_ver_la_disponibilidad_y_guarda_la_credencial_cifrada(ana):
    cliente = APIClient()
    cliente.force_authenticate(user=ana)
    url = cliente.post(f"{URL}conectar/").json()["url"]
    parametros = parse_qs(urlparse(url).query)
    assert parametros["scope"] == [calendario.ALCANCE]
    assert parametros["access_type"] == ["offline"]

    token = _respuesta(200, {"refresh_token": "credencial-secreta", "scope": calendario.ALCANCE})
    with mock.patch.object(calendario.requests, "post", return_value=token):
        retorno = APIClient().get(
            f"{URL}callback/", {"state": parametros["state"][0], "code": "codigo"}
        )
    assert retorno.status_code == 302
    assert retorno["Location"].endswith("calendario=conectado")
    registro = CalendarioGoogle.objects.get(usuario=ana)
    assert "credencial-secreta" not in registro.credencial_cifrada
    assert calendario.descifrar(registro.credencial_cifrada) == "credencial-secreta"

    # El mismo `state` no sirve dos veces.
    with mock.patch.object(calendario.requests, "post", return_value=token):
        otra = APIClient().get(f"{URL}callback/", {"state": parametros["state"][0], "code": "x"})
    assert otra["Location"].endswith("calendario=invalido")


def test_un_permiso_mayor_que_la_disponibilidad_no_se_acepta(ana):
    estado = parse_qs(urlparse(calendario.url_para_conectar(ana)).query)["state"][0]
    token = _respuesta(
        200, {"refresh_token": "x", "scope": "https://www.googleapis.com/auth/calendar"}
    )
    with mock.patch.object(calendario.requests, "post", return_value=token):
        retorno = APIClient().get(f"{URL}callback/", {"state": estado, "code": "codigo"})
    assert retorno["Location"].endswith("calendario=error")
    assert not CalendarioGoogle.objects.filter(usuario=ana).exists()


def _conectado(usuario):
    return CalendarioGoogle.objects.create(
        usuario=usuario, credencial_cifrada=calendario.cifrar("c"), conectado_en=timezone.now()
    )


def test_en_reunion_mientras_dura_y_vuelve_al_terminar(ana):
    registro = _conectado(ana)
    ahora = timezone.now()
    fin = ahora + datetime.timedelta(minutes=40)

    assert calendario.aplicar(registro, fin, ahora) == "puesto"
    estado = EstadoChat.objects.get(usuario=ana)
    assert estado.estado == EstadoChat.Estado.REUNION
    assert estado.hasta == fin

    assert calendario.aplicar(registro, None, fin) == "devuelto"
    estado.refresh_from_db()
    assert estado.estado == EstadoChat.Estado.DISPONIBLE


def test_lo_que_la_persona_eligio_se_respeta(ana):
    registro = _conectado(ana)
    ahora = timezone.now()
    EstadoChat.objects.create(usuario=ana, estado=EstadoChat.Estado.ALMUERZO)
    # En almuerzo: la reunión no lo pisa.
    assert calendario.aplicar(registro, ahora + datetime.timedelta(minutes=30), ahora) == "nada"
    assert EstadoChat.objects.get(usuario=ana).estado == EstadoChat.Estado.ALMUERZO


def test_si_retira_el_permiso_en_google_se_marca_y_no_se_insiste(ana):
    registro = _conectado(ana)
    with mock.patch.object(
        calendario.requests, "post", return_value=_respuesta(400, texto='{"error":"invalid_grant"}')
    ):
        resumen = calendario.revisar_todos()
    assert resumen["errores"] == 1
    registro.refresh_from_db()
    assert registro.error == calendario.PERMISO_PERDIDO


def test_desconectar_revoca_y_borra(ana):
    _conectado(ana)
    cliente = APIClient()
    cliente.force_authenticate(user=ana)
    with mock.patch.object(calendario.requests, "post", return_value=_respuesta(200)) as revocar:
        datos = cliente.delete(URL).json()
    assert datos["conectado"] is False
    assert revocar.call_args.args[0] == calendario.URL_REVOCAR
    assert not CalendarioGoogle.objects.filter(usuario=ana).exists()


def test_sin_el_permiso_no_se_conecta():
    usuario = User.objects.create_user(username="sinperm", email="s@grupolaar.com", password="x")
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    assert cliente.post(f"{URL}conectar/").status_code == 403


def _evento(id_, titulo, inicio, fin, **extra):
    return {
        "id": id_,
        "summary": titulo,
        "start": {"dateTime": inicio.isoformat()},
        "end": {"dateTime": fin.isoformat()},
        **extra,
    }


def test_eventos_descarta_libres_rechazados_y_de_todo_el_dia(ana):
    registro = _conectado(ana)
    ahora = timezone.now()
    en = ahora + datetime.timedelta(minutes=5)
    items = [
        _evento("1", "Cierre de mes", en, en + datetime.timedelta(minutes=30)),
        _evento("2", "Libre", en, en, transparency="transparent"),
        _evento("3", "Rechazada", en, en, attendees=[{"self": True, "responseStatus": "declined"}]),
        {"id": "4", "summary": "Todo el día", "start": {"date": "2026-11-17"}, "end": {}},
        _evento("5", "Oficina", en, en, eventType="workingLocation"),
    ]
    with (
        mock.patch.object(
            calendario.requests, "post", return_value=_respuesta(200, {"access_token": "a"})
        ),
        mock.patch.object(
            calendario.requests, "get", return_value=_respuesta(200, {"items": items})
        ) as get,
    ):
        lista = calendario.eventos(registro, ahora)
    assert [e["titulo"] for e in lista] == ["Cierre de mes"]
    # Solo se piden los campos necesarios: ni invitados ni descripción.
    assert "description" not in get.call_args.kwargs["params"]["fields"]


def test_recordatorio_diez_minutos_antes_una_sola_vez(ana):
    from apps.empresas.models import Empresa, MembresiaEmpresa
    from apps.notificaciones.models import Notificacion

    empresa = Empresa.objects.first() or Empresa.objects.create(nombre="Laar", codigo="LAAR")
    MembresiaEmpresa.objects.create(usuario=ana, empresa=empresa)
    registro = _conectado(ana)
    ahora = timezone.now()
    lista = [
        {
            "id": "a",
            "titulo": "Cierre de mes",
            "inicio": ahora + datetime.timedelta(minutes=8),
            "fin": ahora + datetime.timedelta(minutes=40),
        },
        {
            "id": "b",
            "titulo": "Más tarde",
            "inicio": ahora + datetime.timedelta(hours=2),
            "fin": ahora + datetime.timedelta(hours=3),
        },
    ]
    assert calendario.recordar(registro, lista, ahora) == 1
    assert calendario.recordar(registro, lista, ahora + datetime.timedelta(minutes=5)) == 0
    aviso = Notificacion.objects.todas().get(usuario=ana, tipo=calendario.TIPO_RECORDATORIO)
    assert "Cierre de mes" in aviso.titulo
    assert "8 minutos" in aviso.resumen
