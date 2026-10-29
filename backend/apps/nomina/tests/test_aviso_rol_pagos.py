"""El aviso del rol de pagos al iniciar sesión (aviso del rol de pagos,
29/10/2026).

Lo que se protege: desde el primer día hábil del mes, a quien está habilitado
le sale el aviso de su rol del mes anterior hasta que lo acepta; pasados los
días hábiles permitidos, el mensaje advierte de la sanción. No sale a quien
ya lo aceptó ni a quien dejó una observación, ni a quien no está habilitado
(que recibe un 200 con `mostrar: false`, no un 403), ni antes del primer día
hábil, ni con el aviso apagado. Los textos se administran con
`roles_pago.configurar` y se validan.
"""

import datetime
import types

import pytest
from django.test import override_settings

from apps.core.models import AuditLog
from apps.nomina import aviso
from apps.nomina.models import ConfiguracionRolPagos
from apps.nomina.tests.test_rol_pagos import BASE, _con_codigo, _consultar, _cuenta
from apps.organizacion.models import EventoCalendario

URL = f"{BASE}aviso/"
CONFIG = f"{BASE}configuracion/"


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


@pytest.fixture
def hoy(monkeypatch):
    """Fija «hoy» para el aviso (la fecha de Ecuador)."""

    def fijar(anio, mes, dia):
        fecha = datetime.date(anio, mes, dia)
        monkeypatch.setattr(aviso, "timezone", types.SimpleNamespace(localdate=lambda: fecha))

    return fijar


def _responder(cliente, conformidad, observacion=""):
    consulta = _consultar(cliente)["X-Consulta-Rol"]
    respuesta = cliente.post(
        f"{BASE}conformidad/",
        {"consulta": consulta, "conformidad": conformidad, "observacion": observacion},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data


def test_habilitado_sin_aceptar_ve_el_aviso_de_su_rol_del_mes_anterior(db, hoy):
    # Octubre de 2026: jueves 1 (1.º hábil), viernes 2, lunes 5 (3.º).
    hoy(2026, 10, 5)
    _, rosa = _con_codigo("rosa", "20100001")
    datos = rosa.get(URL).json()
    assert datos == {
        "mostrar": True,
        "anio": 2026,
        "mes": 9,
        "vencido": False,
        "titulo": "Su rol de pagos ya está disponible",
        "mensaje": datos["mensaje"],
        "recordatorio": (
            "Recuerde: tiene hasta el lunes 5 de octubre para aceptar su rol de "
            "pagos de septiembre de 2026. Pasada esa fecha puede recibir una "
            "sanción o un llamado de atención."
        ),
        "dias_habiles": 3,
        "fecha_limite": "2026-10-05",
        "enlace": "/admin/institucional/rol-pagos?anio=2026&mes=9",
    }
    assert "septiembre de 2026" in datos["mensaje"]
    assert "hasta el lunes 5 de octubre" in datos["mensaje"]
    assert "{" not in datos["mensaje"]


def test_pasado_el_plazo_advierte_de_la_sancion(db, hoy):
    hoy(2026, 10, 6)  # 4.º día hábil
    _, rosa = _con_codigo("rosa", "20100001")
    datos = rosa.get(URL).json()
    assert datos["mostrar"] is True and datos["vencido"] is True
    assert datos["titulo"] == "Plazo vencido para aceptar su rol de pagos"
    assert "3 días hábiles" in datos["mensaje"] and "sanción" in datos["mensaje"]
    assert "septiembre de 2026" in datos["mensaje"]
    # La franja de «Recordarme después» también cambia: dice que venció.
    assert datos["recordatorio"].startswith(
        "El plazo para aceptar su rol de pagos de septiembre de 2026 venció el lunes 5 de octubre."
    )


def test_un_feriado_corre_el_plazo(db, hoy):
    # Con el 1 de octubre feriado, el martes 6 es apenas el 3.er día hábil.
    EventoCalendario.objects.create(
        titulo="Feriado", tipo=EventoCalendario.Tipo.FERIADO, fecha=datetime.date(2026, 10, 1)
    )
    hoy(2026, 10, 6)
    _, rosa = _con_codigo("rosa", "20100001")
    assert rosa.get(URL).json()["vencido"] is False


def test_en_enero_es_el_rol_de_diciembre(db, hoy):
    hoy(2027, 1, 4)
    _, rosa = _con_codigo("rosa", "20100001")
    datos = rosa.get(URL).json()
    assert (datos["anio"], datos["mes"]) == (2026, 12)
    assert "diciembre de 2026" in datos["mensaje"]


def test_aceptado_ya_no_sale(db, hoy):
    _, rosa = _con_codigo("rosa", "20100001")
    # Abrirlo no basta.
    _consultar(rosa)
    hoy(2026, 10, 8)
    assert rosa.get(URL).json()["mostrar"] is True
    _responder(rosa, "conforme")
    assert rosa.get(URL).json() == {"mostrar": False}


def test_aceptar_al_cerrar_tambien_cuenta(db, hoy):
    _, rosa = _con_codigo("rosa", "20100001")
    _responder(rosa, "conforme_al_cerrar")
    hoy(2026, 10, 8)
    assert rosa.get(URL).json() == {"mostrar": False}


def test_con_observacion_no_se_le_sigue_presionando(db, hoy):
    _, rosa = _con_codigo("rosa", "20100001")
    _responder(rosa, "observacion", "Faltan las horas extra.")
    hoy(2026, 10, 8)
    assert rosa.get(URL).json() == {"mostrar": False}


def test_no_habilitado_o_sin_codigo_no_lo_ve_y_no_es_un_403(db, hoy):
    hoy(2026, 10, 5)
    from apps.organizacion.tests.test_carga_personas import _cuenta as _sin_permisos

    usuario, nadie = _sin_permisos("nadie")
    usuario.codigo_empleado = "20100005"
    usuario.save()
    respuesta = nadie.get(URL)
    assert respuesta.status_code == 200 and respuesta.json() == {"mostrar": False}
    _, sin_codigo = _cuenta("sincodigo")
    assert sin_codigo.get(URL).json() == {"mostrar": False}


def test_antes_del_primer_dia_habil_no_sale(db, hoy):
    # Noviembre de 2026 empieza en domingo: el 1.º hábil es el lunes 2.
    _, rosa = _con_codigo("rosa", "20100001")
    hoy(2026, 11, 1)
    assert rosa.get(URL).json() == {"mostrar": False}
    hoy(2026, 11, 2)
    datos = rosa.get(URL).json()
    assert datos["mostrar"] is True and (datos["anio"], datos["mes"]) == (2026, 10)


def test_apagado_no_sale(db, hoy):
    hoy(2026, 10, 5)
    _, rosa = _con_codigo("rosa", "20100001")
    config = ConfiguracionRolPagos.objects.first() or ConfiguracionRolPagos.objects.create()
    config.aviso_activo = False
    config.save()
    assert rosa.get(URL).json() == {"mostrar": False}


def test_sin_sesion_no_hay_aviso(db, client):
    assert client.get(URL).status_code == 401


def test_los_marcadores_se_reemplazan_sin_formatear_el_texto():
    texto = "Rol de {mes} {anio}, {dias} días. {0.__class__} {otro} {"
    assert (
        aviso.rellenar(texto, anio=2026, mes=9, dias=5)
        == "Rol de septiembre 2026, 5 días. {0.__class__} {otro} {"
    )


def test_los_textos_del_aviso_se_administran(db, hoy):
    _, th = _cuenta("tatiana", "roles_pago.configurar")
    actual = th.get(CONFIG).json()
    assert actual["aviso_activo"] is True and actual["aviso_dias_habiles"] == 3
    respuesta = th.put(
        CONFIG,
        {
            "terminos": actual["terminos"],
            "consentimiento_correo": actual["consentimiento_correo"],
            "aviso_activo": True,
            "aviso_titulo": "Revise su rol de {mes}",
            "aviso_mensaje": "Tiene {dias} días para aceptarlo.",
            "aviso_titulo_vencido": "Plazo vencido ({mes} {anio})",
            "aviso_mensaje_vencido": "Pasaron los {dias} días.",
            "aviso_dias_habiles": 5,
        },
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.json()["aviso_dias_habiles"] == 5
    # Los términos no cambiaron: la versión tampoco.
    assert respuesta.json()["version"] == actual["version"]
    registro = AuditLog.objects.filter(action="roles_pago.configuracion").latest("created_at")
    assert registro.new_values["aviso_dias_habiles"] == 5
    assert registro.previous_values["aviso_dias_habiles"] == 3

    _, rosa = _con_codigo("rosa", "20100001")
    hoy(2026, 10, 7)  # 5.º día hábil: con 5 permitidos, todavía no vence.
    datos = rosa.get(URL).json()
    assert datos["titulo"] == "Revise su rol de septiembre"
    assert datos["mensaje"] == "Tiene 5 días para aceptarlo."
    hoy(2026, 10, 8)
    datos = rosa.get(URL).json()
    assert datos["titulo"] == "Plazo vencido (septiembre 2026)"


def test_solo_con_permiso_y_con_validacion(db):
    _, rosa = _con_codigo("rosa", "20100001")
    assert rosa.get(CONFIG).status_code == 403
    assert (
        rosa.put(
            CONFIG,
            {"terminos": "x", "consentimiento_correo": "y", "aviso_dias_habiles": 4},
            format="json",
        ).status_code
        == 403
    )

    _, th = _cuenta("tatiana", "roles_pago.configurar")
    base = {"terminos": "Términos.", "consentimiento_correo": "Autorizo."}
    for dias in (0, 21):
        respuesta = th.put(CONFIG, {**base, "aviso_dias_habiles": dias}, format="json")
        assert respuesta.status_code == 400
        assert "aviso_dias_habiles" in str(respuesta.data)
    sin_titulo = th.put(CONFIG, {**base, "aviso_activo": True, "aviso_titulo": "  "}, format="json")
    assert sin_titulo.status_code == 400 and "aviso_titulo" in str(sin_titulo.data)
    largo = th.put(CONFIG, {**base, "aviso_titulo": "x" * 151}, format="json")
    assert largo.status_code == 400
    # Apagado, los títulos pueden quedar vacíos.
    apagado = th.put(
        CONFIG,
        {**base, "aviso_activo": False, "aviso_titulo": "", "aviso_titulo_vencido": ""},
        format="json",
    )
    assert apagado.status_code == 200
    # Sin los campos del aviso, se guardan los términos y el aviso se queda.
    solo_terminos = th.put(CONFIG, base, format="json")
    assert solo_terminos.status_code == 200
    assert solo_terminos.json()["aviso_activo"] is False


def test_el_aviso_dice_las_fechas_del_plazo_con_los_feriados(db, hoy):
    """Noviembre 2026: el 2 y el 3 son feriados; el primer día hábil es el
    miércoles 4 y, con 3 días hábiles, el plazo vence el viernes 6."""
    for dia in (2, 3):
        EventoCalendario.objects.create(
            titulo=f"Feriado {dia}", tipo="feriado", fecha=datetime.date(2026, 11, dia)
        )
    _, rosa = _con_codigo("rosa", "20100001")
    hoy(2026, 11, 4)
    datos = rosa.get(URL).json()
    assert datos["fecha_limite"] == "2026-11-06"
    assert "hasta el viernes 6 de noviembre" in datos["mensaje"]
    assert "desde el miércoles 4 de noviembre" in datos["mensaje"]
    assert "3 días hábiles" in datos["mensaje"]


def test_los_marcadores_de_fecha():
    assert (
        aviso.rellenar(
            "{primer_dia} – {fecha_limite}",
            anio=2026,
            mes=10,
            dias=3,
            primer_dia=datetime.date(2026, 11, 4),
            fecha_limite=datetime.date(2026, 11, 6),
        )
        == "miércoles 4 de noviembre – viernes 6 de noviembre"
    )
