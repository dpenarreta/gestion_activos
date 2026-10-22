"""Quién está en línea y su última conexión (22/10/2026).

Sale de las sesiones: en línea es tener una sesión vigente usada hace poco;
la última conexión, el último uso de cualquiera de sus sesiones.
"""

import uuid
from datetime import timedelta

from django.utils import timezone

from apps.authentication.models import Session
from apps.chat.tests.test_chat import _cliente, _persona, empresa  # noqa: F401
from apps.empresas.models import Empresa

URL = "/api/v1/chat/presencia/"


def _sesion(usuario, *, hace_minutos, cerrada=False):
    sesion = Session.objects.create(
        user=usuario,
        refresh_token_jti=uuid.uuid4().hex,
        expires_at=timezone.now() + timedelta(days=1),
        revoked_at=timezone.now() if cerrada else None,
    )
    usado = timezone.now() - timedelta(minutes=hace_minutos)
    Session.objects.filter(pk=sesion.pk).update(last_used_at=usado)
    return usado


def test_en_linea_y_ultima_conexion(empresa):  # noqa: F811
    yo = _persona("yo", empresa)
    ana = _persona("ana", empresa)
    beto = _persona("beto", empresa)
    cata = _persona("cata", empresa)
    _sesion(ana, hace_minutos=1)
    hace_rato = _sesion(beto, hace_minutos=45)
    _sesion(cata, hace_minutos=1, cerrada=True)  # cerró sesión: ya no está

    datos = _cliente(yo, empresa).get(URL, {"ids": f"{ana.id},{beto.id},{cata.id}"}).json()

    assert datos[str(ana.id)]["en_linea"] is True
    assert datos[str(beto.id)]["en_linea"] is False
    assert datos[str(beto.id)]["ultima_conexion"].startswith(hace_rato.strftime("%Y-%m-%d"))
    assert datos[str(cata.id)]["en_linea"] is False
    assert datos[str(cata.id)]["ultima_conexion"] is not None


def test_solo_de_personas_de_la_empresa(empresa):  # noqa: F811
    yo = _persona("yo", empresa)
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    ajena = _persona("ajena", otra)
    _sesion(ajena, hace_minutos=1)

    datos = _cliente(yo, empresa).get(URL, {"ids": str(ajena.id)}).json()
    assert datos == {}


def test_el_listado_de_usuarios_dice_quien_esta_en_linea(empresa):  # noqa: F811
    admin = _persona("admin2", empresa, "usuarios.ver")
    ana = _persona("ana", empresa)
    _sesion(ana, hace_minutos=1)
    filas = _cliente(admin, empresa).get("/api/v1/admin/users/").json()["results"]
    fila = next(f for f in filas if f["username"] == "ana")
    assert fila["en_linea"] is True and fila["ultima_conexion"]
