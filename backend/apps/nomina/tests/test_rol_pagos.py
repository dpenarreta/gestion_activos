"""Consultar rol de pagos (20/10/2026).

Lo que se protege, y cómo se intenta saltarlo:

- El código sale de la sesión: mandar otro código sin
  `roles_pago.consultar_todos` se niega.
- Sin aceptar los términos vigentes, o con la contraseña equivocada, no hay
  PDF; los fallidos quedan en la auditoría; los términos aceptados se guardan
  tal cual y, si cambian, hay que aceptarlos de nuevo.
- El PDF no se guarda: la constancia no tiene montos.
- Enviar: solo una consulta propia y reciente; el correo escrito no se guarda
  salvo que se pida y se acepte; el guardado se puede retirar.
- Sin procedimiento y fuera de desarrollo, la consulta se niega.
"""

import datetime

import pytest
from django.core import mail
from django.test import override_settings
from django.utils import timezone

from apps.core.models import AuditLog
from apps.empresas.contexto import empresa_actual, usando_empresa
from apps.nomina.models import ConsultaRolPagos
from apps.organizacion.models import DatosDeContacto
from apps.organizacion.tests.test_carga_personas import _cuenta

BASE = "/api/v1/nomina/rol-pagos/"
CLAVE = "Sup3r-Secr3t!"


@pytest.fixture(autouse=True)
def _ejemplo():
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=True):
        yield


def _version(cliente):
    return cliente.get(BASE).json()["version"]


def _consultar(cliente, **extra):
    datos = {
        "anio": 2026,
        "mes": 9,
        "acepto": True,
        "version": _version(cliente),
        "password": CLAVE,
        **extra,
    }
    return cliente.post(f"{BASE}consultar/", datos, format="json")


def _con_codigo(nombre, codigo, *permisos):
    usuario, cliente = _cuenta(nombre, *permisos)
    usuario.codigo_empleado = codigo
    usuario.save()
    return usuario, cliente


def test_sin_codigo_de_empleado_no_hay_consulta(db):
    _, rosa = _cuenta("rosa")
    assert rosa.get(BASE).json()["codigo"] == ""
    respuesta = _consultar(rosa)
    assert respuesta.status_code == 400


def test_consulta_su_rol_con_terminos_y_contrasena(db):
    usuario, rosa = _con_codigo("rosa", "20100001")
    estado = rosa.get(BASE).json()
    assert estado["codigo"] == "20100001"  # el de su cuenta
    assert estado["disponible"] is True and estado["puede_consultar_otros"] is False

    respuesta = _consultar(rosa)
    assert respuesta.status_code == 200
    assert respuesta["Content-Type"] == "application/pdf"
    assert respuesta.content.startswith(b"%PDF")
    assert respuesta["Cache-Control"] == "no-store, private"
    consulta = ConsultaRolPagos.objects.todas().get(pk=respuesta["X-Consulta-Rol"])
    assert (consulta.codigo_empleado, consulta.anio, consulta.mes) == ("20100001", 2026, 9)
    assert consulta.terminos_aceptados == estado["terminos"]
    assert AuditLog.objects.filter(action="roles_pago.consulta.realizada").exists()


def test_los_intentos_de_saltarse_la_consulta(db):
    _, rosa = _con_codigo("rosa", "20100001")
    sin_aceptar = _consultar(rosa, acepto=False)
    assert sin_aceptar.status_code == 400
    mala_clave = _consultar(rosa, password="otra")
    assert mala_clave.status_code == 403
    otro_codigo = _consultar(rosa, codigo="20100002")
    assert otro_codigo.status_code == 403
    futuro = _consultar(rosa, anio=timezone.localdate().year + 1)
    assert futuro.status_code == 400
    assert not ConsultaRolPagos.objects.todas().exists()
    assert AuditLog.objects.filter(action="roles_pago.consulta.rechazada").count() == 4

    # Si los términos cambian mientras los lee, hay que aceptarlos de nuevo.
    _, th = _cuenta("tatiana", "roles_pago.configurar", "roles_pago.consultar_todos")
    version = _version(rosa)
    th.put(
        f"{BASE}configuracion/",
        {"terminos": "Nuevos términos.", "consentimiento_correo": "Autorizo."},
        format="json",
    )
    viejo = _consultar(rosa, version=version)
    assert viejo.status_code == 400
    assert _consultar(rosa).status_code == 200


def test_talento_humano_consulta_otros_y_configura(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _, th = _cuenta("tatiana", "roles_pago.consultar_todos", "roles_pago.configurar")
    assert (
        rosa.put(
            f"{BASE}configuracion/", {"terminos": "x", "consentimiento_correo": "y"}, format="json"
        ).status_code
        == 403
    )
    otro = _consultar(th, codigo="20100001")
    assert otro.status_code == 200
    assert ConsultaRolPagos.objects.todas().get().codigo_empleado == "20100001"


def test_enviar_al_correo_y_guardarlo_solo_si_se_acepta(db):
    usuario, rosa = _con_codigo("rosa", "20100001")
    consulta = _consultar(rosa)["X-Consulta-Rol"]
    url = f"{BASE}enviar/"

    assert rosa.post(url, {"consulta": consulta}, format="json").status_code == 400  # sin correo
    enviado = rosa.post(url, {"consulta": consulta, "correo": "rosa.vera@gmail.com"}, format="json")
    assert enviado.status_code == 200, enviado.data
    assert enviado.json() == {"enviado_a": "r***@gmail.com"}
    assert mail.outbox[-1].to == ["rosa.vera@gmail.com"]
    assert mail.outbox[-1].attachments[0][0] == "rol-de-pagos-2026-09.pdf"
    assert "$" not in mail.outbox[-1].body  # el cuerpo no lleva montos
    # Sin pedirlo, el correo no se guarda.
    assert rosa.get(BASE).json()["correo_guardado"] == ""

    sin_consentimiento = rosa.post(
        url,
        {"consulta": consulta, "correo": "rosa.vera@gmail.com", "guardar": True},
        format="json",
    )
    assert sin_consentimiento.status_code == 400
    guardado = rosa.post(
        url,
        {
            "consulta": consulta,
            "correo": "rosa.vera@gmail.com",
            "guardar": True,
            "acepto_guardar": True,
        },
        format="json",
    )
    assert guardado.status_code == 200
    assert rosa.get(BASE).json()["correo_guardado"] == "r***@gmail.com"
    with usando_empresa(empresa_actual()):
        perfil = DatosDeContacto.objects.get(usuario=usuario)
    assert perfil.correo_personal == "rosa.vera@gmail.com" and perfil.correo_personal_aceptado_en

    # Con el correo guardado basta la consulta. A la cuarta, hay que volver a consultar.
    assert rosa.post(url, {"consulta": consulta}, format="json").status_code == 200
    assert mail.outbox[-1].to == ["rosa.vera@gmail.com"]
    assert rosa.post(url, {"consulta": consulta}, format="json").status_code == 400

    # Se retira cuando quiera.
    assert rosa.delete(f"{BASE}correo-personal/").status_code == 204
    assert rosa.get(BASE).json()["correo_guardado"] == ""


def test_solo_se_envia_una_consulta_propia_y_reciente(db):
    _, rosa = _con_codigo("rosa", "20100001")
    _, pedro = _con_codigo("pedro", "20100002")
    consulta = _consultar(rosa)["X-Consulta-Rol"]
    ajena = pedro.post(
        f"{BASE}enviar/", {"consulta": consulta, "correo": "p@gmail.com"}, format="json"
    )
    assert ajena.status_code == 404
    ConsultaRolPagos.objects.todas().filter(pk=consulta).update(
        created_at=timezone.now() - datetime.timedelta(minutes=20)
    )
    vencida = rosa.post(
        f"{BASE}enviar/", {"consulta": consulta, "correo": "r@gmail.com"}, format="json"
    )
    assert vencida.status_code == 400
    assert mail.outbox == []


def test_sin_procedimiento_fuera_de_desarrollo_no_se_consulta(db):
    _, rosa = _con_codigo("rosa", "20100001")
    with override_settings(NOMINA_ROL_PROCEDIMIENTO="", NOMINA_ROL_DEMO=False):
        assert rosa.get(BASE).json()["disponible"] is False
        assert _consultar(rosa).status_code == 503


def test_el_codigo_lo_asigna_la_administracion_y_es_unico(db):
    rosa, cliente_rosa = _cuenta("rosa")
    _, admin = _cuenta("ines", "usuarios.editar", "usuarios.ver")
    url = f"/api/v1/admin/users/{rosa.id}/"
    asignado = admin.patch(url, {"codigo_empleado": " 20100001 "}, format="json")
    assert asignado.status_code == 200, asignado.data
    assert asignado.json()["codigo_empleado"] == "20100001"
    rosa.refresh_from_db()  # la sesión de prueba guarda la cuenta en memoria
    assert cliente_rosa.get(BASE).json()["codigo"] == "20100001"
    # Único: otra cuenta no puede tener el mismo.
    pedro, _ = _cuenta("pedro")
    repetido = admin.patch(
        f"/api/v1/admin/users/{pedro.id}/", {"codigo_empleado": "20100001"}, format="json"
    )
    assert repetido.status_code == 400
    # La persona no se lo cambia (no tiene cómo: Mi perfil no lo recibe).
    cliente_rosa.put("/api/v1/organizacion/mis-datos/", {"codigo_empleado": "x"}, format="json")
    rosa.refresh_from_db()
    assert rosa.codigo_empleado == "20100001"
    # Vaciarlo lo deja sin código.
    admin.patch(url, {"codigo_empleado": ""}, format="json")
    rosa.refresh_from_db()
    assert rosa.codigo_empleado is None
