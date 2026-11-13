"""El push de cada mensaje del chat (US-011, CA-10, 12/11/2026).

Cada mensaje, de cualquier conversación y también del canal general, genera un
push a todos los destinatarios menos el autor, aunque ya tuvieran un aviso sin
leer de esa conversación (que solo se actualiza en la campana). El push sigue
siendo el genérico de la US-009 y nunca tumba el envío del mensaje.
"""

from unittest import mock

import pytest
import requests
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.authentication.models import Session
from apps.authentication.services import AuthenticationService
from apps.chat.models import Mensaje
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.notificaciones import push
from apps.notificaciones.models import DispositivoPush, Notificacion
from apps.users.models import User

URL = "/api/v1/chat/"
TOKEN = "ExponentPushToken[ChatÑandú-123]"

pytestmark = pytest.mark.django_db


@pytest.fixture
def empresa(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


@pytest.fixture(autouse=True)
def _sin_pausa(monkeypatch):
    monkeypatch.setattr(push, "_pausa_hasta", 0.0)


@pytest.fixture
def lanzar(settings):
    """Push encendido; el lanzador queda parcheado: se ve qué se programó sin
    hilos ni red."""
    settings.PUSH_HABILITADO = True
    settings.EXPO_ACCESS_TOKEN = ""
    with mock.patch.object(push, "_lanzar") as lanzador:
        yield lanzador


def _persona(nombre, empresa, **extra):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
        **extra,
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


def _general(cliente):
    return next(c for c in cliente.get(f"{URL}conversaciones/").json() if c["tipo"] == "general")


def _directa(cliente, otro):
    return cliente.post(f"{URL}conversaciones/directa/", {"usuario": otro.id}).json()


def _escribir(cliente, conversacion, texto):
    respuesta = cliente.post(
        f"{URL}conversaciones/{conversacion['id']}/mensajes/", {"texto": texto}
    )
    assert respuesta.status_code == 201, respuesta.data
    return respuesta


def _programados(lanzador) -> list[dict]:
    """Todo lo que se mandó a push, aplanado."""
    return [n for llamada in lanzador.call_args_list for n in llamada.args[0]]


def test_un_segundo_mensaje_a_quien_ya_tiene_aviso_sin_leer_genera_push(empresa, lanzar):
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana = _cliente(ana, empresa)
    directa = _directa(cliente_ana, beto)

    _escribir(cliente_ana, directa, "Hola, ¿cómo vas?")
    _escribir(cliente_ana, directa, "Te llamo en la mañana")

    aviso = Notificacion.objects.todas().get(usuario=beto, tipo="chat.mensaje")
    assert aviso.resumen == "Ana: Te llamo en la mañana"  # la campana no apila
    assert lanzar.call_count == 2  # pero cada mensaje tiene su push
    assert (
        _programados(lanzar)
        == [{"id": aviso.pk, "usuario_id": beto.pk, "modulo": "chat", "empresa_id": empresa.pk}] * 2
    )


def test_el_autor_no_recibe_push(empresa, lanzar):
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana, cliente_beto = _cliente(ana, empresa), _cliente(beto, empresa)
    directa = _directa(cliente_ana, beto)

    _escribir(cliente_ana, directa, "Primero")
    _escribir(cliente_beto, directa, "Respuesta de Beto")
    _escribir(cliente_ana, directa, "Segundo")

    por_mensaje = [[n["usuario_id"] for n in llamada.args[0]] for llamada in lanzar.call_args_list]
    assert por_mensaje == [[beto.pk], [ana.pk], [beto.pk]]


def test_el_canal_general_avisa_a_todos_menos_al_autor_en_cada_mensaje(empresa, lanzar):
    ana = _persona("ana", empresa)
    demas = [_persona(n, empresa) for n in ("beto", "caro", "dani", "eñe")]
    cliente_ana = _cliente(ana, empresa)
    general = _general(cliente_ana)

    _escribir(cliente_ana, general, "Reunión general a las 15:00")
    _escribir(cliente_ana, general, "Recuerden traer la acción de personal")

    esperados = sorted(p.pk for p in demas)
    for llamada in lanzar.call_args_list:
        assert sorted(n["usuario_id"] for n in llamada.args[0]) == esperados
    assert lanzar.call_count == 2
    assert all(n["modulo"] == "chat" for n in _programados(lanzar))


def test_nadie_recibe_dos_push_por_un_mensaje(empresa, lanzar):
    """Quien ya tenía aviso recibe el push de la actualizada; quien no, el de
    la nueva. Nunca los dos, ni dos por un aviso duplicado."""
    ana, beto, caro = (_persona(n, empresa) for n in ("ana", "beto", "caro"))
    cliente_ana = _cliente(ana, empresa)
    general = _general(cliente_ana)
    _escribir(cliente_ana, general, "Primero")
    # Caro leyó y Beto quedó con un aviso duplicado (dato viejo).
    _cliente(caro, empresa).post(f"{URL}conversaciones/{general['id']}/leer/", {})
    duplicado = Notificacion.objects.todas().get(usuario=beto)
    duplicado.pk = None
    duplicado.save()
    lanzar.reset_mock()

    _escribir(cliente_ana, general, "Segundo")

    destinatarios = [n["usuario_id"] for n in _programados(lanzar)]
    assert sorted(destinatarios) == sorted([beto.pk, caro.pk])


def test_el_canal_general_no_hace_una_consulta_por_persona(empresa, lanzar):
    """Con cientos de personas: el costo de avisar no crece con ellas."""

    def consultas_del_segundo_mensaje(personas):
        autor = personas[0]
        cliente = _cliente(autor, empresa)
        general = _general(cliente)
        _escribir(cliente, general, "Primero")
        with CaptureQueriesContext(connection) as consultas:
            _escribir(cliente, general, "Segundo")
        Mensaje.objects.all().delete()
        Notificacion.objects.todas().all().delete()
        return len(consultas)

    pocas = consultas_del_segundo_mensaje([_persona(f"p{i}", empresa) for i in range(3)])
    muchas = consultas_del_segundo_mensaje(
        [User.objects.get(username="p0")] + [_persona(f"q{i}", empresa) for i in range(20)]
    )
    assert muchas == pocas


def test_la_consulta_de_avisos_pendientes_no_crece_en_parametros(empresa, lanzar):
    """Los destinatarios van como subconsulta: un `IN` con un parámetro por
    persona pasaría el tope de 2100 de SQL Server en un canal general grande."""
    tabla = Notificacion._meta.db_table

    def parametros_de_pendientes(personas):
        autor = personas[0]
        cliente = _cliente(autor, empresa)
        general = _general(cliente)
        _escribir(cliente, general, "Primero")
        capturadas = []

        def registrar(execute, sql, params, many, context):
            if tabla in sql and not sql.lstrip().upper().startswith("INSERT"):
                capturadas.append(len(params or ()))
            return execute(sql, params, many, context)

        with connection.execute_wrapper(registrar):
            _escribir(cliente, general, "Segundo")
        Mensaje.objects.all().delete()
        Notificacion.objects.todas().all().delete()
        return capturadas

    pocas = parametros_de_pendientes([_persona(f"p{i}", empresa) for i in range(3)])
    muchas = parametros_de_pendientes(
        [User.objects.get(username="p0")] + [_persona(f"q{i}", empresa) for i in range(30)]
    )
    assert len(pocas) >= 2  # la lectura de pendientes y su actualización
    assert muchas == pocas


def test_con_el_push_deshabilitado_no_se_envia_nada(empresa, lanzar, settings):
    settings.PUSH_HABILITADO = False
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    cliente_ana = _cliente(ana, empresa)
    directa = _directa(cliente_ana, beto)

    with mock.patch("requests.Session.post") as post:
        _escribir(cliente_ana, directa, "Uno")
        _escribir(cliente_ana, directa, "Dos")

    lanzar.assert_not_called()
    post.assert_not_called()
    assert Notificacion.objects.todas().filter(usuario=beto).count() == 1  # la campana sigue


def _con_telefono(usuario):
    AuthenticationService.issue_tokens_for(usuario, user_agent="IntranetLCE/1.0.0 (android)")
    session = Session.objects.filter(user=usuario).order_by("-created_at").first()
    return DispositivoPush.objects.create(
        usuario=usuario, session=session, token=TOKEN, plataforma="android"
    )


@pytest.mark.parametrize(
    "falla",
    [
        {"lanzar": RuntimeError("el grupo de hilos falló")},
        {"post": requests.ConnectionError("sin red")},
        {"post": RuntimeError("cualquier cosa")},
    ],
)
def test_un_fallo_del_push_no_rompe_el_envio_del_mensaje(empresa, lanzar, falla):
    ana, beto = _persona("ana", empresa), _persona("beto", empresa)
    _con_telefono(beto)
    cliente_ana = _cliente(ana, empresa)
    directa = _directa(cliente_ana, beto)
    lanzar.side_effect = falla.get("lanzar", push.enviar)

    with mock.patch("requests.Session.post", side_effect=falla.get("post")):
        _escribir(cliente_ana, directa, "Uno")
        _escribir(cliente_ana, directa, "Dos")

    assert list(Mensaje.objects.values_list("texto", flat=True).order_by("id")) == ["Uno", "Dos"]
    assert Notificacion.objects.todas().get(usuario=beto).resumen == "Ana: Dos"


def test_el_push_del_chat_sigue_sin_datos_personales(empresa, lanzar):
    ana = _persona("ana", empresa, last_name="Núñez")
    beto = _persona("beto", empresa)
    _con_telefono(beto)
    cliente_ana = _cliente(ana, empresa)
    directa = _directa(cliente_ana, beto)
    lanzar.side_effect = push.enviar

    with mock.patch("requests.Session.post") as post:
        post.return_value = mock.Mock(
            status_code=200, json=mock.Mock(return_value={"data": [{"status": "ok"}]})
        )
        _escribir(cliente_ana, directa, "Mi cédula es 0912345678")
        _escribir(cliente_ana, directa, "Y el sueldo de Cartera")

    aviso = Notificacion.objects.todas().get(usuario=beto)
    assert post.call_count == 2
    for llamada in post.call_args_list:
        assert llamada.kwargs["json"] == [
            {
                "to": TOKEN,
                "title": "Intranet LCE",
                "body": "Tiene una notificación nueva de Chat",
                "data": {"notificacion_id": aviso.pk, "modulo": "chat", "empresa": empresa.pk},
                "sound": "default",
                "channelId": "default",
            }
        ]
        enviado = str(llamada.kwargs["json"])
        for privado in ("0912345678", "sueldo", "Cartera", "Ana", "Núñez", "/admin/chat", "@"):
            assert privado not in enviado
