"""El código por correo para consultar el rol de pagos (US-002, 11/11/2026).

Lo que se protege, y cómo se intenta saltarlo:

- CA-1: «Consultar» envía un código de 6 dígitos al correo de la cuenta; la
  respuesta dice a qué correo (enmascarado), nunca el código.
- CA-2: el código correcto abre el rol y deja la constancia; no sirve dos veces.
- CA-3: incorrecto, vencido, agotado (5 fallos) o de otro período no abre nada
  y cada fallo queda en la auditoría, sin el código.
- CA-4: reenviar anula el anterior; 60 s entre envíos y 5 por hora, con
  `retry_after` en el 429.
- CA-5: sin correo en la cuenta no se genera código.
- CA-6: solo el hash, atado a persona y período; ni en registros ni en la API.
"""

import datetime
import json

import pytest
from django.core import mail
from django.core.cache import cache
from django.utils import timezone

from apps.core.models import AuditLog
from apps.correos.models import PlantillaCorreo
from apps.nomina import codigo as modulo_codigo
from apps.nomina.models import CodigoConsultaRol, ConsultaRolPagos
from apps.nomina.tests.test_rol_pagos import (  # noqa: F401
    BASE,
    _codigo_del_correo,
    _con_codigo,
    _cuenta,
    _ejemplo,
    _otro,
    _pedir_codigo,
    _version,
)

pytestmark = pytest.mark.django_db

URL_CODIGO = f"{BASE}consultar/codigo/"
URL_CONSULTA = f"{BASE}consultar/"


def _confirmar(cliente, escrito, **extra):
    """Escribe el código y pulsa «Confirmar»."""
    datos = {
        "anio": 2026,
        "mes": 9,
        "acepto": True,
        "version": _version(cliente),
        "codigo_verificacion": escrito,
        **extra,
    }
    return cliente.post(URL_CONSULTA, datos, format="json")


def _error(respuesta):
    """El mensaje junto al campo. Los del servicio llegan como texto; los del
    formato (6 dígitos), como lista."""
    detalle = respuesta.json()["error"]["details"]["codigo_verificacion"]
    return detalle if isinstance(detalle, str) else detalle[0]


def _codigos():
    return CodigoConsultaRol.objects.todas()


def _correr_atras(segundos):
    """Simula el paso del tiempo para la espera y el máximo por hora."""
    for registro in _codigos():
        registro.creado_en -= datetime.timedelta(seconds=segundos)
        registro.save(update_fields=["creado_en"])


def _bitacora():
    return json.dumps(
        list(AuditLog.objects.values("action", "new_values", "previous_values")), default=str
    )


# --- CA-1 · Pedir el código --------------------------------------------------------------


def test_consultar_envia_un_codigo_de_seis_digitos_al_correo_de_la_cuenta(db):
    usuario, rosa = _con_codigo("rosa", "20100001")

    respuesta = _pedir_codigo(rosa)

    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json() == {
        "enviado_a": "r***@grupolaar.com",
        "vence_en": 600,
        "reenviar_en": 60,
    }
    assert respuesta["Cache-Control"] == "no-store, private"
    assert len(mail.outbox) == 1
    correo = mail.outbox[0]
    assert correo.to == ["rosa@grupolaar.com"]
    assert correo.subject == "Su código para consultar el rol de pagos"
    html = correo.alternatives[0][0]
    for texto in (correo.body, html):
        assert "10 minutos" in texto
        assert "Nadie de la empresa le pedirá este código" in texto
        assert "septiembre de 2026" in texto
    codigo = _codigo_del_correo()
    assert len(codigo) == 6 and codigo.isdigit()
    assert codigo not in respuesta.content.decode()

    registro = _codigos().get()
    assert (registro.usuario_id, registro.codigo_empleado, registro.anio, registro.mes) == (
        usuario.pk,
        "20100001",
        2026,
        9,
    )
    assert registro.enviado_a == "r***@grupolaar.com"
    assert registro.intentos == 0 and registro.usado_en is None and registro.anulado_en is None
    vigencia = registro.vence_en - registro.creado_en
    assert datetime.timedelta(minutes=9, seconds=59) < vigencia <= datetime.timedelta(minutes=10)

    enviado = AuditLog.objects.get(action="roles_pago.codigo.enviado")
    assert enviado.target_type == "codigoconsultarol" and enviado.target_id == str(registro.pk)
    assert enviado.new_values == {"anio": 2026, "mes": 9, "codigo_empleado": "20100001"}
    assert codigo not in _bitacora()


def test_el_codigo_no_va_a_la_campana(db):
    from apps.notificaciones.models import Notificacion

    _, rosa = _con_codigo("rosa", "20100001")
    assert _pedir_codigo(rosa).status_code == 200
    assert not Notificacion.objects.todas().exists()


def test_pedir_el_codigo_exige_terminos_periodo_y_su_propio_rol(db):
    _, rosa = _con_codigo("rosa", "20100001")

    assert _pedir_codigo(rosa, acepto=False).status_code == 400
    assert _pedir_codigo(rosa, version=999).status_code == 400
    futuro = _pedir_codigo(rosa, anio=timezone.localdate().year + 1)
    assert futuro.status_code == 400
    assert _pedir_codigo(rosa, codigo="20100002").status_code == 403

    assert not _codigos().exists()
    assert mail.outbox == []
    assert AuditLog.objects.filter(action="roles_pago.codigo.rechazado").count() == 4


def test_sin_codigo_de_empleado_no_hay_codigo(db):
    _, rosa = _cuenta("rosa")
    respuesta = _pedir_codigo(rosa)
    assert respuesta.status_code == 400
    assert "codigo" in respuesta.json()["error"]["details"]
    assert not _codigos().exists()


def test_sin_permiso_de_consulta_ni_sesion_no_hay_codigo(db):
    from rest_framework.test import APIClient

    from apps.organizacion.tests.test_carga_personas import _cuenta as _sin_permisos

    curioso, cliente = _sin_permisos("curioso")
    curioso.codigo_empleado = "20100003"
    curioso.save()
    datos = {"anio": 2026, "mes": 9, "acepto": True, "version": 1}
    assert cliente.post(URL_CODIGO, datos, format="json").status_code == 403
    assert APIClient().post(URL_CODIGO, datos, format="json").status_code == 401
    assert not _codigos().exists()


def test_talento_humano_pide_el_codigo_para_el_rol_de_otra_persona(db):
    _, th = _con_codigo("tatiana", "20100099", "roles_pago.consultar_todos")

    respuesta = _pedir_codigo(th, codigo="20100001")

    assert respuesta.status_code == 200
    # Llega a su propio correo y queda atado al código que pidió.
    assert mail.outbox[0].to == ["tatiana@grupolaar.com"]
    codigo = _codigo_del_correo()
    assert _codigos().get().codigo_empleado == "20100001"
    abierto = _confirmar(th, codigo, codigo="20100001")
    assert abierto.status_code == 200
    assert ConsultaRolPagos.objects.todas().get().codigo_empleado == "20100001"


# --- CA-2 · Código correcto --------------------------------------------------------------


def test_el_codigo_correcto_abre_el_rol_una_sola_vez(db):
    usuario, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    codigo = _codigo_del_correo()

    respuesta = _confirmar(rosa, codigo)

    assert respuesta.status_code == 200, respuesta.data
    assert respuesta["Content-Type"] == "application/pdf"
    assert respuesta.content.startswith(b"%PDF")
    consulta = ConsultaRolPagos.objects.todas().get(pk=respuesta["X-Consulta-Rol"])
    assert consulta.usuario_id == usuario.pk
    assert consulta.ip == "127.0.0.1" and consulta.huella_rol and consulta.terminos_aceptados
    assert _codigos().get().usado_en is not None
    assert AuditLog.objects.filter(action="roles_pago.consulta.realizada").exists()

    otra_vez = _confirmar(rosa, codigo)

    assert otra_vez.status_code == 400
    assert _error(otra_vez) == "Pida un código para consultar."
    assert ConsultaRolPagos.objects.todas().count() == 1


def test_sin_pedir_codigo_no_se_consulta(db):
    _, rosa = _con_codigo("rosa", "20100001")
    respuesta = _confirmar(rosa, "123456")
    assert respuesta.status_code == 400
    assert _error(respuesta) == "Pida un código para consultar."
    assert not ConsultaRolPagos.objects.todas().exists()


@pytest.mark.parametrize("valor", ["", "12345", "1234567", "12a456"])
def test_el_codigo_tiene_seis_digitos(db, valor):
    _, rosa = _con_codigo("rosa", "20100001")
    respuesta = _confirmar(rosa, valor)
    assert respuesta.status_code == 400
    assert "codigo_verificacion" in respuesta.json()["error"]["details"]


def test_ya_no_se_acepta_la_contrasena(db):
    _, rosa = _con_codigo("rosa", "20100001")
    datos = {"anio": 2026, "mes": 9, "acepto": True, "version": _version(rosa)}
    respuesta = rosa.post(URL_CONSULTA, {**datos, "password": "Sup3r-Secr3t!"}, format="json")
    assert respuesta.status_code == 400
    assert "codigo_verificacion" in respuesta.json()["error"]["details"]


# --- CA-3 · Incorrecto, vencido, agotado u otro período ----------------------------------


def test_un_codigo_incorrecto_no_abre_y_queda_en_la_auditoria_sin_el_codigo(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    codigo = _codigo_del_correo()
    equivocado = _otro(codigo)

    respuesta = _confirmar(rosa, equivocado)

    assert respuesta.status_code == 400
    assert _error(respuesta) == "El código no es correcto."
    assert _codigos().get().intentos == 1
    assert not ConsultaRolPagos.objects.todas().exists()
    rechazo = AuditLog.objects.get(action="roles_pago.consulta.rechazada")
    assert rechazo.result == "failure"
    assert "El código no es correcto." in rechazo.new_values["motivo"]
    # El fallo de validación genérico también se audita, con el campo tapado.
    generico = AuditLog.objects.get(action="consultarview.validation_failed")
    assert generico.new_values["codigo_verificacion"] == "***"
    bitacora = _bitacora()
    assert codigo not in bitacora and equivocado not in bitacora
    # Y aún le quedan intentos: el bueno abre el rol.
    assert _confirmar(rosa, codigo).status_code == 200


def test_un_codigo_vencido_no_abre(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    codigo = _codigo_del_correo()
    _codigos().update(vence_en=timezone.now() - datetime.timedelta(seconds=1))

    respuesta = _confirmar(rosa, codigo)

    assert respuesta.status_code == 400
    assert _error(respuesta) == "El código venció: pida uno nuevo."
    assert _codigos().get().usado_en is None


def test_al_quinto_fallo_el_codigo_se_anula(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    codigo = _codigo_del_correo()

    errores = [_error(_confirmar(rosa, _otro(codigo))) for _ in range(modulo_codigo.INTENTOS)]

    assert errores[:-1] == ["El código no es correcto."] * (modulo_codigo.INTENTOS - 1)
    assert errores[-1] == "Ya no quedan intentos con este código: pida uno nuevo."
    registro = _codigos().get()
    assert registro.intentos == modulo_codigo.INTENTOS and registro.anulado_en is not None
    # Ni el código correcto sirve ya.
    cache.clear()
    tarde = _confirmar(rosa, codigo)
    assert tarde.status_code == 400
    assert _error(tarde) == "Ya no quedan intentos con este código: pida uno nuevo."
    assert not ConsultaRolPagos.objects.todas().exists()
    assert AuditLog.objects.filter(action="roles_pago.consulta.rechazada").count() == 6


def test_el_codigo_de_otro_periodo_no_es_correcto(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa, mes=9)
    codigo = _codigo_del_correo()

    respuesta = _confirmar(rosa, codigo, mes=8)

    assert respuesta.status_code == 400
    assert _error(respuesta) == "El código no es correcto."
    assert _codigos().get().intentos == 1
    assert _confirmar(rosa, codigo, mes=9).status_code == 200


def test_el_codigo_de_otra_persona_no_sirve(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _, pedro = _con_codigo("pedro", "20100002")
    _pedir_codigo(rosa)
    de_rosa = _codigo_del_correo()
    _pedir_codigo(pedro)
    _codigo_del_correo()

    # Pedro escribe el código de Rosa en su consulta y en la de ella.
    assert _error(_confirmar(pedro, de_rosa)) == "El código no es correcto."
    assert _confirmar(pedro, de_rosa, codigo="20100001").status_code == 403
    assert _confirmar(rosa, de_rosa).status_code == 200


# --- CA-4 · Reenviar ---------------------------------------------------------------------


def test_reenviar_anula_el_anterior_y_espera_sesenta_segundos(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    primero = _codigo_del_correo()

    pronto = _pedir_codigo(rosa)

    assert pronto.status_code == 429
    error = pronto.json()["error"]
    assert 55 <= error["details"]["retry_after"] <= 60
    assert error["message"].startswith("Espere ") and "para pedir otro código" in error["message"]
    assert pronto["Retry-After"] == str(error["details"]["retry_after"])
    assert mail.outbox == [] and _codigos().count() == 1
    assert AuditLog.objects.filter(action="roles_pago.codigo.rechazado").count() == 1

    _correr_atras(61)
    otro = _pedir_codigo(rosa)

    assert otro.status_code == 200
    segundo = _codigo_del_correo()
    anterior, nuevo = _codigos().order_by("creado_en")
    assert anterior.anulado_en is not None and nuevo.anulado_en is None
    if primero != segundo:
        assert _error(_confirmar(rosa, primero)) == "El código no es correcto."
    assert _confirmar(rosa, segundo).status_code == 200


def test_no_mas_de_cinco_codigos_por_hora(db):
    _, rosa = _con_codigo("rosa", "20100001")
    for _ in range(modulo_codigo.MAXIMO_POR_HORA):
        cache.clear()
        assert _pedir_codigo(rosa).status_code == 200
        _codigo_del_correo()
        _correr_atras(61)

    cache.clear()
    sexto = _pedir_codigo(rosa)

    assert sexto.status_code == 429
    error = sexto.json()["error"]
    assert error["message"].startswith("Ya pidió 5 códigos en la última hora.")
    assert "Podrá pedir otro en " in error["message"]
    # El más antiguo se pidió hace 5 × 61 s: sale de la ventana en ~55 minutos.
    assert 3200 <= error["details"]["retry_after"] <= 3300
    assert _codigos().count() == modulo_codigo.MAXIMO_POR_HORA
    assert mail.outbox == []

    # Pasada la hora del más antiguo, vuelve a poder.
    _correr_atras(error["details"]["retry_after"])
    cache.clear()
    assert _pedir_codigo(rosa).status_code == 200


# --- CA-5 · Sin correo -------------------------------------------------------------------


def test_sin_correo_en_la_cuenta_no_se_genera_codigo(db):
    usuario, rosa = _con_codigo("rosa", "20100001")
    usuario.email = ""
    usuario.save()

    respuesta = _pedir_codigo(rosa)

    assert respuesta.status_code == 400
    assert _error(respuesta) == (
        "Su cuenta no tiene un correo registrado: pídale a Talento Humano que lo registre."
    )
    assert not _codigos().exists()
    assert mail.outbox == []


# --- CA-6 · Seguridad del código ---------------------------------------------------------


def test_solo_se_guarda_el_hash_atado_a_persona_y_periodo(db, settings):
    usuario, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    codigo = _codigo_del_correo()
    registro = _codigos().get()

    assert len(registro.hash_codigo) == 64 and codigo not in registro.hash_codigo
    assert registro.hash_codigo == modulo_codigo._hash(usuario.pk, "20100001", 2026, 9, codigo)
    otros = {
        modulo_codigo._hash(usuario.pk + 1, "20100001", 2026, 9, codigo),
        modulo_codigo._hash(usuario.pk, "20100002", 2026, 9, codigo),
        modulo_codigo._hash(usuario.pk, "20100001", 2026, 8, codigo),
    }
    assert registro.hash_codigo not in otros
    # Depende de la clave del servidor: sin ella no se puede probar el millón.
    settings.SECRET_KEY = "otra-clave-de-prueba"
    assert registro.hash_codigo != modulo_codigo._hash(usuario.pk, "20100001", 2026, 9, codigo)


def test_si_el_correo_no_sale_se_dice_y_el_codigo_no_queda(db, monkeypatch):
    _, rosa = _con_codigo("rosa", "20100001")
    capturado = {}

    def falla(*args, **kwargs):
        capturado["cuerpo"] = kwargs.get("message", "")
        raise OSError("SMTP caído")

    monkeypatch.setattr(modulo_codigo, "send_mail", falla)
    # Como en producción: el envío corre al confirmarse la transacción.
    monkeypatch.setattr(modulo_codigo.transaction, "on_commit", lambda funcion, **_: funcion())

    # El registro del sistema no se propaga a la raíz (logging.py): se mira
    # lo que recibe el logger del módulo.
    registros = []
    monkeypatch.setattr(
        modulo_codigo.logger, "error", lambda texto, *args, **_: registros.append(texto % args)
    )
    respuesta = rosa.post(
        URL_CODIGO,
        {"anio": 2026, "mes": 9, "acepto": True, "version": _version(rosa)},
        format="json",
    )

    assert respuesta.status_code == 503
    assert respuesta.json()["error"]["code"] == "codigo_no_enviado"
    assert not _codigos().exists()
    codigo = next(p for p in capturado["cuerpo"].split() if len(p) == 6 and p.isdigit())
    texto = " ".join(registros)
    assert "r***@grupolaar.com" in texto
    assert codigo not in texto and "rosa@grupolaar.com" not in texto
    assert codigo not in _bitacora()


def test_si_el_correo_nuevo_no_sale_el_anterior_sigue_valiendo(db, monkeypatch):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    anterior = _codigo_del_correo()
    _correr_atras(61)

    def falla(*args, **kwargs):
        raise OSError("SMTP caído")

    monkeypatch.setattr(modulo_codigo, "send_mail", falla)
    monkeypatch.setattr(modulo_codigo.transaction, "on_commit", lambda funcion, **_: funcion())
    cache.clear()
    respuesta = rosa.post(
        URL_CODIGO,
        {"anio": 2026, "mes": 9, "acepto": True, "version": _version(rosa)},
        format="json",
    )

    assert respuesta.status_code == 503
    registro = _codigos().get()
    assert registro.anulado_en is None and registro.usado_en is None
    assert _confirmar(rosa, anterior).status_code == 200


def test_con_nomina_caida_el_codigo_sigue_sirviendo(db):
    from django.test import override_settings

    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa)
    codigo = _codigo_del_correo()

    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=False):
        caida = _confirmar(rosa, codigo)

    assert caida.status_code == 503
    assert _codigos().get().usado_en is None
    assert _confirmar(rosa, codigo).status_code == 200
    assert _codigos().get().usado_en is not None


def test_un_mes_sin_rol_gasta_el_codigo(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _pedir_codigo(rosa, anio=2019, mes=12)
    codigo = _codigo_del_correo()

    assert _confirmar(rosa, codigo, anio=2019, mes=12).status_code == 404
    assert _codigos().get().usado_en is not None


def test_al_emitir_se_borran_los_codigos_de_mas_de_una_semana(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _, pedro = _con_codigo("pedro", "20100002")
    _pedir_codigo(pedro)
    _codigo_del_correo()
    _pedir_codigo(rosa)
    _codigo_del_correo()
    _correr_atras(int(datetime.timedelta(days=8).total_seconds()))
    _pedir_codigo(rosa, mes=8)
    _codigo_del_correo()

    restantes = list(_codigos().values_list("usuario__username", "mes"))
    assert restantes == [("rosa", 8)]


def test_una_plantilla_personalizada_sin_el_codigo_no_deja_sin_consultar(db):
    PlantillaCorreo.objects.create(
        clave="roles_pago.codigo_consulta",
        asunto="Su código",
        html="<html><body><p>Hola {{nombre}}, entre al sistema.</p></body></html>",
    )
    _, rosa = _con_codigo("rosa", "20100001")

    assert _pedir_codigo(rosa).status_code == 200

    correo = mail.outbox[0]
    assert "Nadie de la empresa le pedirá este código" in correo.body
    codigo = _codigo_del_correo()
    assert _confirmar(rosa, codigo).status_code == 200


def test_una_plantilla_personalizada_con_el_codigo_es_la_que_sale(db):
    PlantillaCorreo.objects.create(
        clave="roles_pago.codigo_consulta",
        asunto="Código de nómina",
        html="<html><body><p>Su clave temporal: {{codigo}} ({{minutos}} min)</p></body></html>",
    )
    _, rosa = _con_codigo("rosa", "20100001")

    assert _pedir_codigo(rosa).status_code == 200

    assert mail.outbox[0].subject == "Código de nómina"
    assert "Su clave temporal:" in mail.outbox[0].body
