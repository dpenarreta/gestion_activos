"""Regresiones de la ronda de pruebas funcionales de la Matriz (15 de octubre
de 2026).

Cada prueba fija un defecto encontrado contra el sistema completo —backend real
y base SQL Server— y corregido; el docstring dice qué pasaba antes.
"""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.matriz.models import Area, EntidadControl, Periodo
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _cuenta(nombre):
    return User.objects.create_user(
        username=nombre,
        email=f"{nombre}@example.com",
        password="Sup3r-Secr3t!",
        first_name=nombre.capitalize(),
    )


def _miembro(usuario, empresa, rol):
    membresia = MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    membresia.roles.set([Group.objects.get(name=f"Matriz · {rol}")])


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


@pytest.fixture
def escena():
    empresa = Empresa.objects.create(nombre="LaarCourier", codigo="LC")
    gente = {n: _cuenta(n) for n in ("admin", "ana", "beto", "aldo")}
    _miembro(gente["admin"], empresa, "Administrador")
    _miembro(gente["ana"], empresa, "Responsable")
    _miembro(gente["beto"], empresa, "Responsable")
    _miembro(gente["aldo"], empresa, "Auditor")
    return {
        "gente": gente,
        **{n: _cliente(u, empresa) for n, u in gente.items()},
    }


def _datos(escena, **extra):
    return {
        "nombre": "Declaración de IVA",
        "area": Area.objects.get(codigo="CONT").id,
        "entidad": EntidadControl.objects.get(codigo="SRI").id,
        "periodicidad": "mensual",
        "evidencia_esperada": "Formulario 104",
        "fecha_vencimiento": "2099-10-28",
        "responsable": escena["gente"]["ana"].id,
        **extra,
    }


def _alta(escena, cliente="admin", **extra):
    return escena[cliente].post(
        "/api/v1/matriz/obligaciones/", _datos(escena, **extra), format="json"
    )


@pytest.mark.parametrize("filtro", ["area", "entity", "responsible", "obligation"])
def test_un_filtro_por_identificador_no_numerico_es_400(escena, filtro):
    """Antes: `?area=abc` era un error 500."""
    respuesta = escena["admin"].get(f"/api/v1/matriz/periodos/?{filtro}=abc")
    assert respuesta.status_code == 400


def test_la_auditoria_con_un_actor_no_numerico_es_400(escena):
    """Antes: `?actor=abc` era un error 500."""
    assert escena["aldo"].get("/api/v1/matriz/auditoria/?actor=abc").status_code == 400


def test_ceder_el_periodo_responde_200_y_dice_que_ya_no_es_suyo(escena):
    """Antes: el cambio se guardaba, pero la respuesta era 404 —se releía con la
    visibilidad de quien acababa de dejar de verlo— y parecía un fallo."""
    pid = _alta(escena).data["id"]
    respuesta = escena["ana"].patch(
        f"/api/v1/matriz/periodos/{pid}/",
        {"responsable": escena["gente"]["beto"].id},
        format="json",
    )
    assert respuesta.status_code == 200
    assert respuesta.data["visible"] is False
    assert Periodo.objects.todas().get(pk=pid).responsable == escena["gente"]["beto"]
    propio = escena["admin"].patch(f"/api/v1/matriz/periodos/{pid}/", {"avance": 10}, format="json")
    assert propio.data["visible"] is True


def test_sin_ver_todas_no_se_crea_lo_que_no_se_podria_ver(escena):
    """Antes: una Responsable creaba una obligación para otra persona y en el
    mismo instante dejaba de verla (404 al abrirla)."""
    ajena = _alta(escena, "ana", responsable=escena["gente"]["beto"].id)
    assert ajena.status_code == 400
    assert "responsable" in ajena.data["error"]["details"]
    como_suplente = _alta(
        escena,
        "ana",
        nombre="Aportes al IESS",
        responsable=escena["gente"]["beto"].id,
        suplente=escena["gente"]["ana"].id,
    )
    assert como_suplente.status_code == 201
    # Con `ver_todas`, se crea para quien sea.
    assert (
        _alta(escena, nombre="Patente", responsable=escena["gente"]["beto"].id).status_code == 201
    )


@pytest.mark.parametrize(
    "extra,campo",
    [
        (
            {"periodicidad": "anual", "mes_vencimiento": 5, "fecha_vencimiento": None},
            "dia_vencimiento",
        ),
        ({"mes_vencimiento": 5, "dia_vencimiento": 10}, "mes_vencimiento"),
    ],
)
def test_el_mes_del_vencimiento_solo_en_anuales_y_con_dia(escena, extra, campo):
    """Antes: un mes sin día se aceptaba y el primer vencimiento salía de
    «hoy + 30» sin que nadie lo notara."""
    respuesta = _alta(escena, **extra)
    assert respuesta.status_code == 400
    assert campo in respuesta.data["error"]["details"]


def test_el_suplente_no_puede_ser_el_responsable(escena):
    ana = escena["gente"]["ana"].id
    assert _alta(escena, suplente=ana).status_code == 400
    pid = _alta(escena).data["id"]
    respuesta = escena["admin"].patch(
        f"/api/v1/matriz/periodos/{pid}/", {"suplente": ana}, format="json"
    )
    assert respuesta.status_code == 400


def test_editar_la_plantilla_conserva_la_regla_de_mes_y_dia(escena):
    pid = _alta(escena, periodicidad="anual", dia_vencimiento=10, mes_vencimiento=5).data["id"]
    obligacion = Periodo.objects.todas().get(pk=pid).obligacion_id
    respuesta = escena["admin"].patch(
        f"/api/v1/matriz/obligaciones/{obligacion}/", {"periodicidad": "mensual"}, format="json"
    )
    assert respuesta.status_code == 400


def test_el_correo_tiene_tiempo_de_espera(settings):
    """Antes: sin `EMAIL_TIMEOUT`, un servidor SMTP que acepta la conexión y no
    responde dejaba el envío esperando para siempre (comprobado contra un
    servidor mudo: el proceso hubo que cortarlo)."""
    from django.conf import settings as configuracion
    from django.core.mail import get_connection

    assert configuracion.EMAIL_TIMEOUT and configuracion.EMAIL_TIMEOUT > 0
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    assert get_connection().timeout == configuracion.EMAIL_TIMEOUT
