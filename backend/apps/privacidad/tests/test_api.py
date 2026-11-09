"""La API de solicitudes de derechos sobre datos personales: el titular pide y
sigue las suyas; quien atiende las ve en su bandeja y responde.

Cubre el camino feliz, los datos inválidos, sin sesión, sin permiso, la
solicitud ajena, las transiciones inválidas, la idempotencia, los avisos y la
auditoría (sin el texto libre).
"""

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.notificaciones.models import Notificacion
from apps.privacidad.models import MovimientoSolicitud, SolicitudDerechos

from .conftest import BASE, client_for, make_user

pytestmark = pytest.mark.django_db

DESCRIPCION = "Mi apellido figura como «Penaherrera»; lo correcto es Peñaherrera."


def _pedir(cliente, tipo="RECTIFICACION", descripcion=DESCRIPCION):
    return cliente.post(
        f"{BASE}/mis-solicitudes/", {"tipo": tipo, "descripcion": descripcion}, format="json"
    )


def _solicitud(titular, **extra) -> SolicitudDerechos:
    datos = {
        "titular": titular,
        "tipo": "ACCESO",
        "fecha_limite": timezone.localdate() + timedelta(days=15),
        "plazo_dias": 15,
        **extra,
    }
    return SolicitudDerechos.objects.create(**datos)


def _mover(cliente, pk, estado, respuesta="", **extra):
    return cliente.post(
        f"{BASE}/solicitudes/{pk}/estado/",
        {"estado": estado, "respuesta": respuesta, **extra},
        format="json",
    )


# ── El titular ────────────────────────────────────────────────────────────────


def test_sin_sesion_no_hay_nada():
    cliente = APIClient()
    assert cliente.get(f"{BASE}/mis-solicitudes/").status_code == 401
    assert cliente.get(f"{BASE}/mis-datos/").status_code == 401
    assert cliente.get(f"{BASE}/solicitudes/").status_code == 401


def test_cualquier_cuenta_pide_sin_permiso_y_queda_con_su_plazo(
    begona, admin_gh, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = _pedir(client_for(begona))

    assert respuesta.status_code == 201
    datos = respuesta.json()
    assert datos["numero"].startswith("LOPDP-")
    assert datos["estado"] == "PENDIENTE"
    assert datos["tipo_label"] == "Corrección de datos"
    assert datos["plazo_dias"] == 15
    assert datos["fecha_limite"] == (timezone.localdate() + timedelta(days=15)).isoformat()
    assert datos["dias_restantes"] == 15 and datos["vencida"] is False
    assert [h["estado_nuevo"] for h in datos["historial"]] == ["PENDIENTE"]
    # El titular no ve quién de la empresa movió cada estado.
    assert "actor" not in datos["historial"][0]

    solicitud = SolicitudDerechos.objects.get()
    assert solicitud.titular == begona and solicitud.descripcion == DESCRIPCION

    # Aviso a quien atiende, nunca al titular.
    avisos = Notificacion.objects.filter(tipo="privacidad.nueva_solicitud")
    assert [a.usuario for a in avisos] == [admin_gh]
    assert avisos[0].enlace == f"/admin/privacidad/solicitudes/{solicitud.pk}"
    # Sin la descripción: la campana dice qué se pidió, no el dato en cuestión.
    assert "Penaherrera" not in avisos[0].resumen


def test_la_auditoria_no_guarda_el_texto_de_la_solicitud(begona):
    _pedir(client_for(begona))
    evento = AuditLog.objects.get(action="privacidad.solicitud.creada")
    assert evento.module == "privacidad"
    assert evento.new_values["tipo"] == "RECTIFICACION"
    assert evento.new_values["con_descripcion"] is True
    assert DESCRIPCION not in str(evento.new_values)


def test_el_plazo_sale_del_ajuste(begona, settings):
    settings.PRIVACIDAD_PLAZO_DIAS = 10
    datos = _pedir(client_for(begona), tipo="ACCESO", descripcion="").json()
    assert datos["plazo_dias"] == 10
    assert datos["fecha_limite"] == (timezone.localdate() + timedelta(days=10)).isoformat()


@pytest.mark.parametrize(
    ("cuerpo", "campo"),
    [
        ({"tipo": "RECTIFICACION", "descripcion": "   "}, "descripcion"),
        ({"tipo": "OPOSICION"}, "tipo"),
        ({"tipo": "ELIMINACION", "descripcion": "ñ" * 2001}, "descripcion"),
        ({}, "tipo"),
    ],
)
def test_datos_invalidos(begona, cuerpo, campo):
    respuesta = client_for(begona).post(f"{BASE}/mis-solicitudes/", cuerpo, format="json")
    assert respuesta.status_code == 400
    error = respuesta.json()["error"]
    assert error["code"] == "validation_error"
    assert campo in error["details"]
    assert not SolicitudDerechos.objects.exists()
    # El cuerpo no se copia a la auditoría (es la descripción).
    assert not AuditLog.objects.filter(action__endswith="validation_failed").exists()


def test_doble_clic_no_crea_dos(begona):
    cliente = client_for(begona)
    primera = _pedir(cliente)
    segunda = _pedir(cliente)
    assert primera.status_code == 201 and segunda.status_code == 200
    assert primera.json()["id"] == segunda.json()["id"]
    assert SolicitudDerechos.objects.count() == 1
    # Otra distinta sí se registra.
    assert _pedir(cliente, tipo="ELIMINACION", descripcion="").status_code == 201


def test_cada_titular_ve_solo_las_suyas(begona, nunez):
    propia = _solicitud(begona)
    ajena = _solicitud(nunez, tipo="ELIMINACION")
    cliente = client_for(begona)

    ids = [s["id"] for s in cliente.get(f"{BASE}/mis-solicitudes/").json()]
    assert ids == [propia.pk]
    assert cliente.get(f"{BASE}/mis-solicitudes/{propia.pk}/").status_code == 200
    ajena_resp = cliente.get(f"{BASE}/mis-solicitudes/{ajena.pk}/")
    assert ajena_resp.status_code == 404
    assert ajena_resp.json()["error"]["code"] == "not_found"


def test_me_dice_que_puede_hacer(begona, admin_gh, lectora):
    assert client_for(begona).get(f"{BASE}/me/").json()["puede_ver_bandeja"] is False
    datos = client_for(lectora).get(f"{BASE}/me/").json()
    assert datos["puede_ver_bandeja"] is True and datos["puede_atender"] is False
    datos = client_for(admin_gh).get(f"{BASE}/me/").json()
    assert datos["puede_atender"] is True and datos["plazo_dias"] == 15
    assert {t["value"] for t in datos["tipos"]} == {"ACCESO", "RECTIFICACION", "ELIMINACION"}


# ── Quien atiende ─────────────────────────────────────────────────────────────


def test_sin_permiso_no_hay_bandeja_y_queda_en_la_auditoria(begona, nunez):
    solicitud = _solicitud(nunez)
    cliente = client_for(begona)
    for url in (
        f"{BASE}/solicitudes/",
        f"{BASE}/solicitudes/{solicitud.pk}/",
        f"{BASE}/solicitudes/{solicitud.pk}/datos/",
    ):
        respuesta = cliente.get(url)
        assert respuesta.status_code == 403, url
        assert respuesta.json()["error"]["code"] == "permission_denied"
    assert _mover(cliente, solicitud.pk, "RESUELTA", "Listo").status_code == 403
    assert AuditLog.objects.filter(action="access_denied", actor=begona).count() == 4
    solicitud.refresh_from_db()
    assert solicitud.estado == "PENDIENTE"


def test_ver_lee_la_bandeja_pero_no_responde(lectora, begona):
    solicitud = _solicitud(begona)
    cliente = client_for(lectora)
    datos = cliente.get(f"{BASE}/solicitudes/").json()
    assert datos["count"] == 1
    fila = datos["results"][0]
    assert fila["titular"] == {
        "id": begona.pk,
        "nombre": "Begoña Peñaherrera",
        "usuario": "bpenaherrera",
        "correo": "bpenaherrera@example.com",
    }
    detalle = cliente.get(f"{BASE}/solicitudes/{solicitud.pk}/").json()
    assert detalle["puede_descargar_datos"] is False
    assert _mover(cliente, solicitud.pk, "EN_PROCESO").status_code == 403
    assert cliente.get(f"{BASE}/solicitudes/{solicitud.pk}/datos/").status_code == 403


def test_bandeja_con_filtros_y_lo_urgente_primero(admin_gh, begona, nunez):
    hoy = timezone.localdate()
    vencida = _solicitud(begona, fecha_limite=hoy - timedelta(days=1))
    a_tiempo = _solicitud(nunez, tipo="ELIMINACION", fecha_limite=hoy)
    cerrada = _solicitud(begona, estado="RESUELTA", fecha_limite=hoy - timedelta(days=30))
    cliente = client_for(admin_gh)

    datos = cliente.get(f"{BASE}/solicitudes/").json()
    assert [s["id"] for s in datos["results"]] == [vencida.pk, a_tiempo.pk, cerrada.pk]
    assert datos["totales"] == {"abiertas": 2, "vencidas": 1}
    assert datos["results"][0]["vencida"] is True
    # El último día todavía está a tiempo; una cerrada nunca está vencida.
    assert datos["results"][1]["vencida"] is False and datos["results"][2]["vencida"] is False

    def ids(query):
        return [s["id"] for s in cliente.get(f"{BASE}/solicitudes/?{query}").json()["results"]]

    assert ids("vencidas=1") == [vencida.pk]
    assert ids("tipo=ELIMINACION") == [a_tiempo.pk]
    assert ids("estado=RESUELTA") == [cerrada.pk]
    # Sin tildes ni mayúsculas, como el resto de los listados.
    assert ids("q=nunez") == [a_tiempo.pk]

    invalido = cliente.get(f"{BASE}/solicitudes/?estado=BORRADA")
    assert invalido.status_code == 400
    assert "estado" in invalido.json()["error"]["details"]


@pytest.mark.parametrize("como", ["LOPDP-{n:05d}", "lopdp-{n}", "{n:05d}", "{n}"])
def test_bandeja_busca_por_numero(admin_gh, begona, nunez, como):
    """El número que la persona dicta por teléfono o copia de un correo
    encuentra su solicitud, con o sin «LOPDP-», ceros y mayúsculas."""
    buscada = _solicitud(nunez)
    _solicitud(begona)
    cliente = client_for(admin_gh)
    q = como.format(n=buscada.pk)
    datos = cliente.get(f"{BASE}/solicitudes/", {"q": q}).json()
    assert [s["id"] for s in datos["results"]] == [buscada.pk]


def test_bandeja_el_numero_no_quita_la_busqueda_por_titular(admin_gh, begona):
    """Un número suma la búsqueda por id, no la reemplaza: un usuario con
    cifras se sigue encontrando por su nombre de usuario."""
    con_cifras = make_user("operador2024", first_name="Rosa", last_name="Vera")
    suya = _solicitud(con_cifras)
    _solicitud(begona)
    cliente = client_for(admin_gh)
    assert [
        s["id"] for s in cliente.get(f"{BASE}/solicitudes/", {"q": "2024"}).json()["results"]
    ] == [suya.pk]
    # «LOPDP-0» o «LOPDP-» sin número no son un id: no rompen ni encuentran todo.
    for q in ("LOPDP-0", "LOPDP-"):
        respuesta = cliente.get(f"{BASE}/solicitudes/", {"q": q})
        assert respuesta.status_code == 200
        assert respuesta.json()["results"] == []


def test_resolver_avisa_al_titular_por_campana_y_correo_sin_la_respuesta(
    admin_gh, begona, django_capture_on_commit_callbacks
):
    solicitud = _solicitud(begona, tipo="RECTIFICACION", descripcion=DESCRIPCION)
    cliente = client_for(admin_gh)
    respuesta_al_titular = "Corregimos su apellido a «Peñaherrera» en su ficha y en su cuenta."

    with django_capture_on_commit_callbacks(execute=True):
        primero = _mover(cliente, solicitud.pk, "EN_PROCESO", estado_esperado="PENDIENTE")
    assert primero.status_code == 200 and primero.json()["estado"] == "EN_PROCESO"

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        resuelta = _mover(cliente, solicitud.pk, "RESUELTA", respuesta_al_titular)
    assert resuelta.status_code == 200
    datos = resuelta.json()
    assert datos["estado"] == "RESUELTA" and datos["respuesta"] == respuesta_al_titular
    assert datos["resuelta_por"]["id"] == admin_gh.pk and datos["resuelta_en"]
    assert [h["estado_nuevo"] for h in datos["historial"]] == ["EN_PROCESO", "RESUELTA"]
    assert datos["historial"][-1]["actor"]["nombre"] == "Adela Ibáñez"

    # El titular lee la respuesta en su solicitud.
    propia = client_for(begona).get(f"{BASE}/mis-solicitudes/{solicitud.pk}/").json()
    assert propia["respuesta"] == respuesta_al_titular

    avisos = Notificacion.objects.filter(tipo="privacidad.solicitud_actualizada")
    assert {a.usuario_id for a in avisos} == {begona.pk}
    assert avisos.count() == 2
    # El aviso lleva a esa solicitud en «Mis derechos», no a la lista entera.
    enlace = f"/admin/perfil?seccion=mis-derechos&solicitud={solicitud.pk}"
    assert {a.enlace for a in avisos} == {enlace}
    assert len(mail.outbox) == 1
    correo = mail.outbox[0]
    assert correo.to == ["bpenaherrera@example.com"]
    assert solicitud.numero in correo.subject and "Resuelta" in correo.subject
    # El correo sale del perímetro: no lleva la respuesta.
    assert respuesta_al_titular not in correo.body
    assert respuesta_al_titular not in correo.alternatives[0][0]
    assert f"seccion=mis-derechos&solicitud={solicitud.pk}" in correo.body

    evento = AuditLog.objects.filter(action="privacidad.solicitud.estado").latest("id")
    assert evento.previous_values == {"estado": "EN_PROCESO"}
    assert evento.new_values == {"estado": "RESUELTA", "con_respuesta": True}


def test_un_correo_caido_no_deshace_la_respuesta(
    admin_gh, begona, django_capture_on_commit_callbacks, monkeypatch
):
    from django.core.mail import EmailMultiAlternatives

    def falla(self, *args, **kwargs):
        raise OSError("SMTP caído")

    monkeypatch.setattr(EmailMultiAlternatives, "send", falla)
    solicitud = _solicitud(begona)
    with django_capture_on_commit_callbacks(execute=True):
        respuesta = _mover(client_for(admin_gh), solicitud.pk, "RECHAZADA", "No procede.")
    assert respuesta.status_code == 200
    solicitud.refresh_from_db()
    assert solicitud.estado == "RECHAZADA"
    assert Notificacion.objects.filter(usuario=begona).exists()


def test_transiciones_invalidas(admin_gh, begona):
    solicitud = _solicitud(begona)
    cliente = client_for(admin_gh)

    sin_respuesta = _mover(cliente, solicitud.pk, "RESUELTA")
    assert sin_respuesta.status_code == 400
    assert "respuesta" in sin_respuesta.json()["error"]["details"]

    rechazada = _mover(
        cliente, solicitud.pk, "RECHAZADA", "Hay que conservarlos por ley (Código del Trabajo)."
    )
    assert rechazada.status_code == 200
    solicitud.refresh_from_db()
    assert solicitud.estado == "RECHAZADA"

    otra_vez = _mover(cliente, solicitud.pk, "RESUELTA", "Ya está.")
    assert otra_vez.status_code == 409
    assert otra_vez.json()["error"]["code"] == "transicion_invalida"
    assert otra_vez.json()["error"]["details"] == {"estado_actual": "RECHAZADA"}

    assert _mover(cliente, solicitud.pk, "PENDIENTE", "Vuelve").status_code == 409
    assert _mover(cliente, solicitud.pk, "OTRO", "x").status_code == 400


def test_reabrir_pide_motivo_y_limpia_quien_resolvio(admin_gh, begona):
    solicitud = _solicitud(begona)
    cliente = client_for(admin_gh)
    _mover(cliente, solicitud.pk, "RESUELTA", "Le enviamos sus datos.")

    assert _mover(cliente, solicitud.pk, "EN_PROCESO").status_code == 400
    reabierta = _mover(cliente, solicitud.pk, "EN_PROCESO", "Faltó adjuntar la hoja de tareas.")
    assert reabierta.status_code == 200
    datos = reabierta.json()
    assert datos["estado"] == "EN_PROCESO"
    assert datos["resuelta_por"] is None and datos["resuelta_en"] is None
    assert MovimientoSolicitud.objects.filter(solicitud=solicitud).count() == 2


def test_dos_personas_a_la_vez_la_segunda_recibe_409(admin_gh, begona):
    solicitud = _solicitud(begona)
    otra = make_user("otraadmin", perms=["privacidad.atender"])
    assert (
        _mover(client_for(admin_gh), solicitud.pk, "EN_PROCESO", estado_esperado="PENDIENTE")
    ).status_code == 200
    tarde = _mover(client_for(otra), solicitud.pk, "RESUELTA", "Listo", estado_esperado="PENDIENTE")
    assert tarde.status_code == 409
    assert tarde.json()["error"]["code"] == "conflicto"
    solicitud.refresh_from_db()
    assert solicitud.estado == "EN_PROCESO"


def test_una_solicitud_que_no_existe_da_404(admin_gh):
    cliente = client_for(admin_gh)
    assert cliente.get(f"{BASE}/solicitudes/999999/").status_code == 404
    assert _mover(cliente, 999999, "EN_PROCESO").status_code == 404
