"""El push de la app «Intranet LCE» (US-009).

Lo que se protege: que cada teléfono quede unido a una persona y a una sesión
(y un token, a una sola cuenta); que nadie apague el push de otro; que el push
nunca lleve más que el nombre del módulo y los IDs; que Expo caído no tumbe la
notificación ni lo que la disparó; y que una sesión cerrada deje de recibirlo.
"""

import json
from datetime import timedelta
from unittest import mock

import pytest
import requests
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient

from apps.authentication.models import Session
from apps.authentication.services import AuthenticationService, SessionService
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.notificaciones import push, services
from apps.notificaciones.models import DispositivoPush, Notificacion
from apps.users.models import User

URL = "/api/v1/notificaciones/dispositivos/"
URL_BAJA = "/api/v1/notificaciones/dispositivos/baja/"
UA_ANDROID = "IntranetLCE/1.0.0 (android)"
TOKEN = "ExponentPushToken[xXn-AbC_123]"
TOKEN_2 = "ExpoPushToken[OtroTelefono456]"

pytestmark = pytest.mark.django_db


@pytest.fixture
def empresa(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


def _usuario(nombre, empresa, **extra):
    usuario = User.objects.create_user(
        username=nombre,
        email=f"{nombre}@grupolaar.com",
        password="Sup3r-Secr3t!",
        **extra,
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    return usuario


def _entrar(usuario, empresa, user_agent=UA_ANDROID):
    """Un cliente con JWT de verdad: el registro necesita la `Session` del token."""
    tokens = AuthenticationService.issue_tokens_for(usuario, user_agent=user_agent)
    cliente = APIClient()
    cliente.credentials(
        HTTP_AUTHORIZATION=f"Bearer {tokens['access']}", HTTP_X_EMPRESA=str(empresa.id)
    )
    session = Session.objects.filter(user=usuario).order_by("-created_at").first()
    return cliente, session


@pytest.fixture
def ana(empresa):
    return _usuario("ana", empresa, first_name="Ana María", last_name="Núñez")


@pytest.fixture(autouse=True)
def _sin_pausa(monkeypatch):
    """Cada prueba empieza sin la pausa que deja un fallo de red de otra."""
    monkeypatch.setattr(push, "_pausa_hasta", 0.0)


@pytest.fixture
def push_encendido(settings):
    """Push encendido, sin hilo (el envío corre en la misma prueba) y sin red."""
    settings.PUSH_HABILITADO = True
    settings.EXPO_ACCESS_TOKEN = ""
    with (
        mock.patch.object(push, "_lanzar", side_effect=push.enviar) as lanzar,
        mock.patch("requests.Session.post") as post,
    ):
        post.return_value = _respuesta_ok(1)
        yield post, lanzar


def _respuesta(tickets, status_code=200):
    respuesta = mock.Mock(status_code=status_code)
    respuesta.json.return_value = {"data": tickets}
    return respuesta


def _respuesta_ok(n):
    return _respuesta([{"status": "ok", "id": f"t{i}"} for i in range(n)])


def _dispositivo(usuario, session, token=TOKEN, **extra):
    return DispositivoPush.objects.create(
        usuario=usuario, session=session, token=token, plataforma="android", **extra
    )


def _notificar(usuario, capturar, **extra):
    datos = {
        "tipo": "soporte.ticket_asignado",
        "titulo": "Ticket TI-12 de Ana María Núñez",
        "resumen": "Le asignaron el ticket de la impresora de Cartera",
        "enlace": "/admin/soporte/tickets/12",
    }
    datos.update(extra)
    with capturar(execute=True):
        return services.notificar([usuario], **datos)


# --- Registro ------------------------------------------------------------------------------


def test_registrar_el_telefono_lo_une_a_la_persona_y_a_su_sesion(ana, empresa):
    cliente, session = _entrar(ana, empresa)

    respuesta = cliente.post(
        URL, {"token": TOKEN, "plataforma": "android", "nombre": "Pixel 7"}, format="json"
    )

    assert respuesta.status_code == 201
    assert respuesta.data["creado"] is True
    assert respuesta.data["plataforma"] == "android"
    assert respuesta.data["nombre"] == "Pixel 7"
    assert "token" not in respuesta.data
    dispositivo = DispositivoPush.objects.get()
    assert (dispositivo.usuario, dispositivo.session, dispositivo.activo) == (ana, session, True)


def test_la_sesion_de_la_app_se_ve_como_intranet_lce(ana, empresa):
    _, session = _entrar(ana, empresa)
    _, session_ios = _entrar(ana, empresa, user_agent="IntranetLCE/1.0.0 (ios)")
    _, session_web = _entrar(ana, empresa, user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/130")

    assert session.device == "Intranet LCE · Android"
    assert session_ios.device == "Intranet LCE · iOS"
    assert session_web.device == "Escritorio"


def test_registrar_otra_vez_el_mismo_token_responde_200_y_no_duplica(ana, empresa):
    cliente, _ = _entrar(ana, empresa)
    cliente.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    respuesta = cliente.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    assert respuesta.status_code == 200
    assert respuesta.data["creado"] is False
    assert DispositivoPush.objects.count() == 1


def test_el_token_de_otra_cuenta_pasa_a_la_actual(ana, empresa):
    """Un teléfono nunca recibe avisos de dos cuentas."""
    luis = _usuario("luis", empresa)
    cliente_luis, session_luis = _entrar(luis, empresa)
    cliente_luis.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")
    SessionService.logout(session_luis)
    cliente_ana, session_ana = _entrar(ana, empresa)

    respuesta = cliente_ana.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    assert respuesta.status_code == 200
    dispositivo = DispositivoPush.objects.get()
    assert (dispositivo.usuario, dispositivo.session, dispositivo.activo) == (
        ana,
        session_ana,
        True,
    )


def test_un_token_nuevo_en_la_misma_sesion_apaga_el_anterior(ana, empresa):
    cliente, _ = _entrar(ana, empresa)
    cliente.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    cliente.post(URL, {"token": TOKEN_2, "plataforma": "android"}, format="json")

    assert set(DispositivoPush.objects.values_list("token", "activo")) == {
        (TOKEN, False),
        (TOKEN_2, True),
    }


@pytest.mark.parametrize(
    "cuerpo, campo",
    [
        ({"token": "fcm:APA91bHPRgkF", "plataforma": "android"}, "token"),
        ({"token": "ExponentPushToken[]", "plataforma": "android"}, "token"),
        ({"token": "ExponentPushToken[a b]", "plataforma": "android"}, "token"),
        ({"token": "ExponentPushToken[" + "x" * 200 + "]", "plataforma": "android"}, "token"),
        ({"plataforma": "android"}, "token"),
        ({"token": TOKEN, "plataforma": "windows"}, "plataforma"),
        ({"token": TOKEN}, "plataforma"),
        ({"token": TOKEN, "plataforma": "ios", "nombre": "ñ" * 101}, "nombre"),
    ],
)
def test_datos_invalidos_responden_400_con_el_contrato(ana, empresa, cuerpo, campo):
    cliente, _ = _entrar(ana, empresa)

    respuesta = cliente.post(URL, cuerpo, format="json")

    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "validation_error"
    assert error["message"]
    assert campo in error["details"]
    assert not DispositivoPush.objects.exists()


def test_sin_sesion_responde_401_con_el_contrato(empresa):
    respuesta = APIClient().post(URL, {"token": TOKEN, "plataforma": "ios"}, format="json")

    assert respuesta.status_code == 401
    assert respuesta.json()["error"]["code"] == "not_authenticated"


def test_con_la_sesion_revocada_responde_401(ana, empresa):
    cliente, session = _entrar(ana, empresa)
    SessionService.logout(session)

    respuesta = cliente.post(URL, {"token": TOKEN, "plataforma": "ios"}, format="json")

    assert respuesta.status_code == 401
    assert respuesta.json()["error"]["message"] == "La sesión ya no es válida."
    assert not DispositivoPush.objects.exists()


def test_sin_la_sesion_del_token_no_se_registra(ana, empresa):
    """Autenticado sin `Session` (no pasa con el JWT real): no hay a qué unirlo."""
    cliente = APIClient()
    cliente.force_authenticate(user=ana)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))

    respuesta = cliente.post(URL, {"token": TOKEN, "plataforma": "ios"}, format="json")

    assert respuesta.status_code == 401
    assert respuesta.json()["error"]["code"] == "not_authenticated"


def test_la_ruta_del_dispositivo_no_choca_con_el_detalle_de_la_notificacion(ana, empresa):
    cliente, _ = _entrar(ana, empresa)

    assert cliente.get(URL).status_code == 405  # no es `/{pk}/` con pk «dispositivos»


# --- Baja ----------------------------------------------------------------------------------


def test_la_baja_apaga_el_telefono_y_es_idempotente(ana, empresa):
    cliente, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    primera = cliente.post(URL_BAJA, {"token": TOKEN}, format="json")
    segunda = cliente.post(URL_BAJA, {"token": TOKEN}, format="json")
    desconocido = cliente.post(URL_BAJA, {"token": "ExponentPushToken[nadie]"}, format="json")

    assert (primera.status_code, segunda.status_code, desconocido.status_code) == (204, 204, 204)
    assert DispositivoPush.objects.get().activo is False


def test_la_baja_de_un_token_ajeno_no_tiene_efecto(ana, empresa):
    luis = _usuario("luis", empresa)
    _, session_luis = _entrar(luis, empresa)
    _dispositivo(luis, session_luis)
    cliente_ana, _ = _entrar(ana, empresa)

    respuesta = cliente_ana.post(URL_BAJA, {"token": TOKEN}, format="json")

    assert respuesta.status_code == 204
    assert DispositivoPush.objects.get().activo is True


def test_la_baja_sin_sesion_responde_401(empresa):
    respuesta = APIClient().post(URL_BAJA, {"token": TOKEN}, format="json")

    assert respuesta.status_code == 401


def test_la_baja_sin_token_responde_400(ana, empresa):
    cliente, _ = _entrar(ana, empresa)

    respuesta = cliente.post(URL_BAJA, {}, format="json")

    assert respuesta.status_code == 400
    assert "token" in respuesta.json()["error"]["details"]


# --- Envío ---------------------------------------------------------------------------------


def test_el_push_es_generico_sin_datos_personales(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    dispositivo = _dispositivo(ana, session)

    _notificar(ana, django_capture_on_commit_callbacks)

    notificacion = Notificacion.objects.todas().get()
    post.assert_called_once()
    argumentos = post.call_args.kwargs
    assert argumentos["timeout"] == (3, 5)  # conexión y lectura
    assert "Authorization" not in argumentos["headers"]
    assert argumentos["json"] == [
        {
            "to": TOKEN,
            "title": "Intranet LCE",
            "body": "Tiene una notificación nueva de Mesa de ayuda",
            "data": {"notificacion_id": notificacion.pk, "modulo": "soporte", "empresa": None},
            "sound": "default",
            "channelId": "default",
        }
    ]
    enviado = str(argumentos["json"])
    for privado in ("TI-12", "Ana", "Núñez", "impresora", "/admin/soporte", "ana@"):
        assert privado not in enviado
    dispositivo.refresh_from_db()
    assert dispositivo.ultimo_envio_en is not None


def test_con_token_de_expo_va_la_cabecera_authorization(
    ana, empresa, push_encendido, settings, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    settings.EXPO_ACCESS_TOKEN = "secreto-de-pruebas"
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    _notificar(ana, django_capture_on_commit_callbacks)

    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer secreto-de-pruebas"


def test_el_push_sale_despues_del_commit(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        services.notificar([ana], tipo="soporte.ticket_asignado", titulo="Ticket")

    post.assert_not_called()  # la transacción no se ha confirmado
    assert len(callbacks) == 1


def test_los_mensajes_van_en_lotes_de_100(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    DispositivoPush.objects.bulk_create(
        [
            DispositivoPush(
                usuario=ana,
                session=session,
                token=f"ExponentPushToken[tel{i:03d}]",
                plataforma="android",
            )
            for i in range(230)
        ]
    )
    post.side_effect = lambda url, json, headers, timeout: _respuesta_ok(len(json))

    _notificar(ana, django_capture_on_commit_callbacks)

    assert [len(c.kwargs["json"]) for c in post.call_args_list] == [100, 100, 30]
    assert not DispositivoPush.objects.filter(ultimo_envio_en__isnull=True).exists()


def test_device_not_registered_desactiva_el_token(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _, otra_session = _entrar(ana, empresa)
    viejo = _dispositivo(ana, session)
    vigente = _dispositivo(ana, otra_session, token=TOKEN_2)
    # El orden de los mensajes sigue al de la consulta (los más nuevos primero).
    post.side_effect = lambda url, json, headers, timeout: _respuesta(
        [
            (
                {"status": "ok", "id": "t1"}
                if m["to"] == TOKEN_2
                else {
                    "status": "error",
                    "message": "no registrado",
                    "details": {"error": "DeviceNotRegistered"},
                }
            )
            for m in json
        ]
    )

    _notificar(ana, django_capture_on_commit_callbacks)

    viejo.refresh_from_db()
    vigente.refresh_from_db()
    assert (viejo.activo, viejo.ultimo_envio_en) == (False, None)
    assert vigente.activo is True and vigente.ultimo_envio_en is not None


@pytest.mark.parametrize(
    "falla",
    [
        requests.Timeout("Expo tardó"),
        requests.ConnectionError("sin red"),
        RuntimeError("cualquier cosa"),
    ],
)
def test_expo_caido_no_tumba_notificar_y_la_notificacion_queda(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks, falla
):
    post, _ = push_encendido
    post.side_effect = falla
    _, session = _entrar(ana, empresa)
    dispositivo = _dispositivo(ana, session)

    with mock.patch.object(push, "logger") as registro:
        creadas = _notificar(ana, django_capture_on_commit_callbacks)

    assert creadas == 1
    assert Notificacion.objects.todas().filter(usuario=ana).count() == 1
    dispositivo.refresh_from_db()
    assert (dispositivo.activo, dispositivo.ultimo_envio_en) == (True, None)
    # El fallo queda en el log `apps.notificaciones`, sin el token del teléfono.
    assert push.logger.name == "apps.notificaciones"
    llamadas = registro.warning.call_args_list + registro.exception.call_args_list
    assert llamadas
    assert TOKEN not in str(llamadas)


@pytest.mark.parametrize(
    "respuesta",
    [
        _respuesta([], status_code=500),
        _respuesta([{"status": "ok"}, {"status": "ok"}]),  # no cuadra con el lote
        mock.Mock(status_code=200, json=mock.Mock(side_effect=ValueError("no es JSON"))),
    ],
)
def test_una_respuesta_rara_de_expo_se_registra_y_sigue(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks, respuesta
):
    post, _ = push_encendido
    post.return_value = respuesta
    post.side_effect = None
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    assert _notificar(ana, django_capture_on_commit_callbacks) == 1
    assert DispositivoPush.objects.get().ultimo_envio_en is None


def test_enviar_nunca_lanza_aunque_falle_la_base(ana):
    with (
        mock.patch.object(DispositivoPush.objects, "filter", side_effect=RuntimeError("caída")),
        mock.patch.object(push, "logger") as registro,
    ):
        enviados = push.enviar([{"id": 1, "usuario_id": ana.pk, "modulo": "soporte"}])

    assert enviados == 0
    registro.exception.assert_called_once()


def test_el_hilo_cierra_su_conexion_a_la_base(ana):
    with (
        mock.patch.object(push, "enviar") as enviar,
        mock.patch.object(push.connection, "close") as cerrar,
    ):
        push._en_hilo([{"id": 1, "usuario_id": ana.pk, "modulo": "soporte"}])

    enviar.assert_called_once()
    cerrar.assert_called_once()


def test_programar_usa_un_grupo_de_hilos_con_tope_y_sin_daemon(ana, settings, monkeypatch):
    """Mil avisos no abren mil hilos; y los hilos no son daemon, así que el
    push de un comando programado no se pierde cuando el comando termina."""
    settings.PUSH_HABILITADO = True
    monkeypatch.setattr(push, "_GRUPO", None)
    hechos = []
    with mock.patch.object(push, "enviar", side_effect=hechos.append):
        for i in range(5):
            push.programar([{"id": i, "usuario_id": ana.pk, "modulo": "soporte"}])
        grupo = push._grupo()
        grupo.shutdown(wait=True)  # lo mismo que hace el intérprete al salir

    assert grupo is push._GRUPO
    assert grupo._max_workers == 2
    assert 1 <= len(grupo._threads) <= 2
    assert not any(hilo.daemon for hilo in grupo._threads)
    assert all(hilo.name.startswith("push-expo") for hilo in grupo._threads)
    assert sorted(lote[0]["id"] for lote in hechos) == [0, 1, 2, 3, 4]


def test_un_envio_usa_una_sola_conexion_http_para_todos_sus_lotes(ana, empresa, push_encendido):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    DispositivoPush.objects.bulk_create(
        [
            DispositivoPush(
                usuario=ana, session=session, token=f"ExponentPushToken[t{i}]", plataforma="ios"
            )
            for i in range(150)
        ]
    )
    post.side_effect = lambda url, json, headers, timeout: _respuesta_ok(len(json))

    with mock.patch("requests.Session", wraps=requests.Session) as sesiones:
        push.enviar([{"id": 1, "usuario_id": ana.pk, "modulo": "soporte", "empresa_id": None}])

    assert sesiones.call_count == 1
    assert post.call_count == 2


def test_el_push_lleva_el_id_de_la_empresa(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    """La app lo usa como `X-Empresa` al abrir el detalle (decisión del Tech Lead)."""
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    with django_capture_on_commit_callbacks(execute=True):
        services.notificar([ana], tipo="soporte.x", titulo="Ticket", empresa=empresa)

    notificacion = Notificacion.objects.todas().get()
    assert post.call_args.kwargs["json"][0]["data"] == {
        "notificacion_id": notificacion.pk,
        "modulo": "soporte",
        "empresa": empresa.id,
    }


def test_la_sesion_revocada_no_recibe_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)
    # `revoke()` a secas (como el cierre por inactividad) no apaga la fila:
    # igual no se envía porque la sesión ya no está vigente.
    session.revoke()

    _notificar(ana, django_capture_on_commit_callbacks)

    post.assert_not_called()
    assert Notificacion.objects.todas().filter(usuario=ana).count() == 1


def test_la_sesion_vencida_no_recibe_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)
    Session.objects.filter(pk=session.pk).update(expires_at=timezone.now() - timedelta(minutes=1))

    _notificar(ana, django_capture_on_commit_callbacks)

    post.assert_not_called()


def test_el_telefono_dado_de_baja_no_recibe_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session, activo=False)

    _notificar(ana, django_capture_on_commit_callbacks)

    post.assert_not_called()


def test_cada_quien_recibe_solo_su_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    luis = _usuario("luis", empresa)
    _, session_luis = _entrar(luis, empresa)
    _dispositivo(luis, session_luis, token=TOKEN_2)

    _notificar(ana, django_capture_on_commit_callbacks)

    post.assert_not_called()


def test_con_el_push_apagado_no_hay_llamadas(
    ana, empresa, push_encendido, settings, django_capture_on_commit_callbacks
):
    post, lanzar = push_encendido
    settings.PUSH_HABILITADO = False
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        creadas = services.notificar([ana], tipo="soporte.ticket_asignado", titulo="Ticket")

    assert creadas == 1
    assert callbacks == []
    lanzar.assert_not_called()
    post.assert_not_called()


def test_el_aviso_por_correo_tambien_manda_el_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    """`desde_correo` pasa por `notificar`: el push sale igual."""
    post, _ = push_encendido
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    with django_capture_on_commit_callbacks(execute=True):
        services.desde_correo(
            clave="solicitudes.recibida",
            asunto="Solicitud SOL-1 de Ana María Núñez",
            variables={"enlace": "/admin/solicitudes/1"},
            direcciones=["ana@grupolaar.com"],
        )

    mensaje = post.call_args.kwargs["json"][0]
    assert mensaje["body"] == "Tiene una notificación nueva de Gestión de Activos · Solicitudes"
    assert "SOL-1" not in str(mensaje)


# --- Revocar la sesión corta el push --------------------------------------------------------


def test_logout_apaga_los_telefonos_de_esa_sesion(ana, empresa):
    cliente, session = _entrar(ana, empresa)
    _, otra = _entrar(ana, empresa)
    _dispositivo(ana, session)
    _dispositivo(ana, otra, token=TOKEN_2)

    assert cliente.post("/api/v1/auth/logout/").status_code == 204

    assert dict(DispositivoPush.objects.values_list("token", "activo")) == {
        TOKEN: False,
        TOKEN_2: True,
    }


def test_logout_all_apaga_todos_los_telefonos(ana, empresa):
    cliente, session = _entrar(ana, empresa)
    _, otra = _entrar(ana, empresa)
    _dispositivo(ana, session)
    _dispositivo(ana, otra, token=TOKEN_2)

    assert cliente.post("/api/v1/auth/logout-all/").status_code == 204

    assert not DispositivoPush.objects.filter(activo=True).exists()


def test_deshabilitar_al_usuario_apaga_sus_telefonos(ana, empresa):
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    ana.status = User.Status.DISABLED
    ana.save()

    assert DispositivoPush.objects.get().activo is False


def test_si_apagar_los_telefonos_falla_el_logout_sigue(ana, empresa):
    cliente, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    with mock.patch.object(
        DispositivoPush.objects, "filter", side_effect=RuntimeError("base caída")
    ):
        respuesta = cliente.post("/api/v1/auth/logout/")

    assert respuesta.status_code == 204
    session.refresh_from_db()
    assert session.revoked_at is not None


def test_cerrada_por_inactividad_no_recibe_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks, settings
):
    """La sesión que se cierra sola por 4 h sin uso (`SessionAuthentication`)."""
    post, _ = push_encendido
    cliente, session = _entrar(ana, empresa)
    _dispositivo(ana, session)
    Session.objects.filter(pk=session.pk).update(
        last_used_at=timezone.now() - settings.SESSION_IDLE_TIMEOUT - timedelta(minutes=1)
    )

    respuesta = cliente.get("/api/v1/notificaciones/")
    _notificar(ana, django_capture_on_commit_callbacks)

    assert respuesta.status_code == 401
    assert respuesta.json()["error"]["code"] == "session_idle_timeout"
    session.refresh_from_db()
    assert session.revoked_at is not None
    post.assert_not_called()


def test_cerrada_por_reutilizar_el_refresh_no_recibe_push(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    tokens = AuthenticationService.issue_tokens_for(ana, user_agent=UA_ANDROID)
    session = Session.objects.get(user=ana)
    _dispositivo(ana, session)
    AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])

    with pytest.raises(AuthenticationFailed):
        AuthenticationService.refresh_tokens(refresh_token_str=tokens["refresh"])
    _notificar(ana, django_capture_on_commit_callbacks)

    session.refresh_from_db()
    assert session.revoked_at is not None
    post.assert_not_called()


# --- Carrera, límite y «Mis datos» --------------------------------------------------------


def test_la_carrera_del_mismo_token_responde_200_con_una_sola_fila(ana, empresa):
    """Dos registros simultáneos: el otro insertó primero y este choca con el
    índice único. Se actualiza la fila del otro y queda unida a esta sesión."""
    luis = _usuario("luis", empresa)
    _, session_luis = _entrar(luis, empresa)
    cliente, session = _entrar(ana, empresa)
    # El registro que ganó la carrera, ya confirmado en otra transacción: por
    # eso se crea fuera del intento que choca (su savepoint se deshace).
    _dispositivo(luis, session_luis)
    original = DispositivoPush.objects.update_or_create
    intentos = []

    def con_carrera(**kwargs):
        if not intentos:
            intentos.append(1)
            raise IntegrityError("UNIQUE KEY token")
        return original(**kwargs)

    with mock.patch.object(DispositivoPush.objects, "update_or_create", side_effect=con_carrera):
        respuesta = cliente.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    assert respuesta.status_code == 200
    assert respuesta.data["creado"] is False
    dispositivo = DispositivoPush.objects.get()
    assert (dispositivo.usuario, dispositivo.session, dispositivo.activo) == (ana, session, True)


def test_pasado_el_limite_responde_429_con_el_contrato(ana, empresa):
    """Contra el límite real de la configuración (ver `test_auth_security`)."""
    from rest_framework.settings import api_settings

    cupo = int(api_settings.DEFAULT_THROTTLE_RATES["dispositivos_push"].split("/")[0])
    cliente, _ = _entrar(ana, empresa)

    codigos = [
        cliente.post(URL_BAJA, {"token": TOKEN}, format="json").status_code for _ in range(cupo)
    ]
    cortada = cliente.post(URL, {"token": TOKEN, "plataforma": "ios"}, format="json")

    assert codigos == [204] * cupo
    assert cortada.status_code == 429
    error = cortada.json()["error"]
    assert error["code"] == "throttled"
    assert error["message"].startswith("Demasiadas solicitudes seguidas")
    assert "Retry-After" in cortada
    assert not DispositivoPush.objects.exists()


def test_mis_datos_trae_los_telefonos_sin_el_token(ana, empresa):
    cliente, session = _entrar(ana, empresa)
    _dispositivo(ana, session, nombre="Galaxy A54")

    respuesta = cliente.get("/api/v1/privacidad/mis-datos/")

    assert respuesta.status_code == 200
    contenido = json.loads(respuesta.content)
    seccion = next(s for s in contenido["secciones"] if s["clave"] == "dispositivos_para_avisos")
    assert len(seccion["registros"]) == 1
    registro = seccion["registros"][0]
    assert set(registro) == {"plataforma", "modelo", "activo", "registrado_el", "ultimo_aviso"}
    assert (registro["plataforma"], registro["modelo"], registro["activo"]) == (
        "android",
        "Galaxy A54",
        True,
    )
    texto = respuesta.content.decode("utf-8")
    assert "PushToken" not in texto and "xXn-AbC_123" not in texto


def test_el_texto_del_dispositivo_no_lleva_el_token(ana, empresa):
    _, session = _entrar(ana, empresa)
    sin_nombre = _dispositivo(ana, session)
    con_nombre = _dispositivo(ana, session, token=TOKEN_2, nombre="Pixel 7")

    assert str(sin_nombre) == f"Android · #{sin_nombre.pk}"
    assert str(con_nombre) == "Android · Pixel 7"


# --- Ronda 2: pausa tras un fallo de red, choques del registro, cierres de sesión ----------


@pytest.mark.parametrize(
    "falla", [requests.ConnectTimeout("sin red"), requests.ReadTimeout("lento")]
)
def test_un_fallo_de_red_pausa_el_envio_y_lo_que_sigue_se_omite(
    ana, empresa, push_encendido, monkeypatch, falla
):
    """Sin salida a exp.host, un comando programado no espera un timeout por
    cada aviso: tras el primer fallo, lo demás se omite durante la pausa."""
    post, _ = push_encendido
    post.side_effect = falla
    _, session = _entrar(ana, empresa)
    DispositivoPush.objects.bulk_create(
        [
            DispositivoPush(
                usuario=ana, session=session, token=f"ExponentPushToken[p{i}]", plataforma="ios"
            )
            for i in range(250)
        ]
    )
    ahora = [1000.0]
    monkeypatch.setattr(push, "_reloj", lambda: ahora[0])
    lote = [{"id": 1, "usuario_id": ana.pk, "modulo": "soporte", "empresa_id": None}]

    with mock.patch.object(push.connection, "close"), mock.patch.object(push, "logger") as log:
        push._en_hilo(lote)  # el primer lote falla: los otros dos ya no se intentan
        assert post.call_count == 1
        assert push.en_pausa()

        ahora[0] += push.PAUSA_SEGUNDOS - 1
        push._en_hilo(lote)  # en pausa: ni siquiera se consulta a Expo
        assert post.call_count == 1
        assert any("omitido" in str(c) for c in log.info.call_args_list)

        ahora[0] += 2  # pasó la pausa: se vuelve a intentar
        post.side_effect = lambda url, json, headers, timeout: _respuesta_ok(len(json))
        push._en_hilo(lote)
    assert post.call_count == 1 + 3
    assert not push.en_pausa()


def test_un_error_http_que_no_es_de_red_no_pausa(ana, empresa, push_encendido):
    post, _ = push_encendido
    post.side_effect = requests.TooManyRedirects("vueltas")
    _, session = _entrar(ana, empresa)
    _dispositivo(ana, session)

    push.enviar([{"id": 1, "usuario_id": ana.pk, "modulo": "soporte", "empresa_id": None}])

    assert not push.en_pausa()


def test_dos_choques_seguidos_igual_registran(ana, empresa):
    luis = _usuario("luis", empresa)
    _, session_luis = _entrar(luis, empresa)
    cliente, session = _entrar(ana, empresa)
    _dispositivo(luis, session_luis)  # el que ganó, en otra transacción
    original = DispositivoPush.objects.update_or_create
    choques = []

    def chocando(**kwargs):
        if len(choques) < 2:
            choques.append(1)
            raise IntegrityError("UNIQUE KEY token")
        return original(**kwargs)

    with mock.patch.object(DispositivoPush.objects, "update_or_create", side_effect=chocando):
        respuesta = cliente.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    assert respuesta.status_code == 200
    assert len(choques) == 2
    dispositivo = DispositivoPush.objects.get()
    assert (dispositivo.usuario, dispositivo.session) == (ana, session)


def test_tres_choques_seguidos_responden_409_y_no_500(ana, empresa):
    cliente, _ = _entrar(ana, empresa)

    with mock.patch.object(
        DispositivoPush.objects, "update_or_create", side_effect=IntegrityError("UNIQUE")
    ) as registrar:
        respuesta = cliente.post(URL, {"token": TOKEN, "plataforma": "android"}, format="json")

    assert registrar.call_count == 3
    assert respuesta.status_code == 409
    error = respuesta.json()["error"]
    assert error["code"] == "dispositivo_en_conflicto"
    assert error["message"].startswith("No se pudo registrar el teléfono")


def test_cambiar_la_contrasena_corta_el_push_de_las_otras_sesiones(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    """`change_own_password` revoca las demás sesiones y conserva la actual."""
    post, _ = push_encendido
    cliente_a, session_a = _entrar(ana, empresa)
    _, session_b = _entrar(ana, empresa, user_agent="IntranetLCE/1.0.0 (ios)")
    telefono_a = _dispositivo(ana, session_a)
    telefono_b = _dispositivo(ana, session_b, token=TOKEN_2)

    respuesta = cliente_a.post(
        "/api/v1/auth/password/change/",
        {
            "current_password": "Sup3r-Secr3t!",
            "new_password": "Otr4-Clav3-Mas-Larga!",
            "new_password_confirm": "Otr4-Clav3-Mas-Larga!",
        },
        format="json",
    )
    _notificar(ana, django_capture_on_commit_callbacks)

    assert respuesta.status_code == 204, respuesta.content
    session_a.refresh_from_db()
    session_b.refresh_from_db()
    assert session_a.revoked_at is None and session_b.revoked_at is not None
    telefono_a.refresh_from_db()
    telefono_b.refresh_from_db()
    assert (telefono_a.activo, telefono_b.activo) == (True, False)
    assert [m["to"] for m in post.call_args.kwargs["json"]] == [TOKEN]


def test_el_administrador_revoca_las_sesiones_y_apaga_todos_los_telefonos(
    ana, empresa, push_encendido, django_capture_on_commit_callbacks
):
    post, _ = push_encendido
    _, session_a = _entrar(ana, empresa)
    _, session_b = _entrar(ana, empresa)
    _dispositivo(ana, session_a)
    _dispositivo(ana, session_b, token=TOKEN_2)
    raiz = User.objects.create_user(
        username="raiz", email="raiz@grupolaar.com", password="Sup3r-Secr3t!", is_superuser=True
    )
    administrador = APIClient()
    administrador.force_authenticate(user=raiz)

    respuesta = administrador.post(f"/api/v1/admin/users/{ana.id}/sessions/revoke/")
    _notificar(ana, django_capture_on_commit_callbacks)

    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json()["revoked_count"] == 2
    assert not DispositivoPush.objects.filter(activo=True).exists()
    post.assert_not_called()
