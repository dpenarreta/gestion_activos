"""La campana: lo que le llega a cada persona, de qué módulo y a dónde lleva.

Lo que se protege: que cada aviso por correo a alguien con cuenta deje su
notificación (aunque el SMTP falle); que el enlace sea siempre una ruta del
sistema; que el de recuperar la contraseña nunca quede guardado; y que cada
quien vea y marque solo lo suyo, en su empresa.
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.alertas import eventos
from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.notificaciones import services
from apps.notificaciones.models import Notificacion
from apps.users.models import User

URL = "/api/v1/notificaciones/"


@pytest.fixture
def empresa(db):
    return Empresa.objects.create(nombre="LaarCourier", codigo="LC")


def _usuario(nombre, empresa):
    usuario = User.objects.create_user(
        username=nombre, email=f"{nombre}@x.com", password="Sup3r-Secr3t!"
    )
    MembresiaEmpresa.objects.create(usuario=usuario, empresa=empresa)
    return usuario


def _cliente(usuario, empresa):
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    cliente.credentials(HTTP_X_EMPRESA=str(empresa.id))
    return cliente


def _aviso(direcciones, enlace):
    return eventos.enviar(
        clave="solicitudes.recibida",
        variables={"enlace": enlace, "numero": "SOL-1"},
        destinatarios=eventos.Destinatarios(direcciones=direcciones),
    )


def test_un_aviso_por_correo_deja_la_notificacion_con_modulo_y_enlace(empresa, settings):
    ana = _usuario("ana", empresa)
    with usando_empresa(empresa):
        _aviso(["ANA@x.com", "externo@otra.com"], f"{settings.FRONTEND_URL}/admin/solicitudes/7")
        notificacion = Notificacion.objects.get()
    assert notificacion.usuario == ana  # el externo no tiene cuenta: solo correo
    assert notificacion.modulo == "solicitudes"
    assert notificacion.enlace == "/admin/solicitudes/7"
    assert notificacion.empresa == empresa

    datos = _cliente(ana, empresa).get(f"{URL}resumen/").json()
    assert datos["no_leidas"] == 1
    reciente = datos["recientes"][0]
    assert reciente["modulo_nombre"] == "Gestión de Activos · Solicitudes"
    assert reciente["icono"] == "inbox"
    assert reciente["titulo"]  # el nombre del aviso
    assert reciente["resumen"]  # su asunto


def test_si_el_correo_falla_la_campana_igual_lo_tiene(empresa, settings):
    _usuario("ana", empresa)
    with (
        usando_empresa(empresa),
        mock.patch(
            "apps.alertas.eventos.EmailMultiAlternatives.send", side_effect=OSError("SMTP caído")
        ),
    ):
        assert _aviso(["ana@x.com"], "") is False
        assert Notificacion.objects.count() == 1


def test_el_enlace_nunca_lleva_a_otro_sitio():
    assert services.enlace_interno("https://malo.com/robar") == ""
    assert services.enlace_interno("//malo.com") == ""
    assert services.enlace_interno("/admin/activos/3") == "/admin/activos/3"


def test_la_recuperacion_de_contrasena_no_va_a_la_campana(empresa):
    _usuario("ana", empresa)
    with usando_empresa(empresa):
        services.desde_correo(
            clave="acceso.recuperar_contrasena",
            asunto="Recuperar",
            variables={"enlace": "/restablecer/secreto"},
            direcciones=["ana@x.com"],
        )
        assert not Notificacion.objects.exists()


def test_cada_quien_ve_y_marca_solo_lo_suyo(empresa):
    ana, beto = _usuario("ana", empresa), _usuario("beto", empresa)
    with usando_empresa(empresa):
        services.notificar([ana], tipo="soporte.ticket_asignado", titulo="Ticket asignado")
        services.notificar([beto], tipo="matriz.recordatorio", titulo="Recordatorio")
    de_beto = Notificacion.objects.todas().get(usuario=beto)

    cliente = _cliente(ana, empresa)
    assert [n["titulo"] for n in cliente.get(URL).json()["results"]] == ["Ticket asignado"]
    assert cliente.post(f"{URL}{de_beto.id}/leer/").status_code == 404

    propia = cliente.get(URL).json()["results"][0]
    assert cliente.post(f"{URL}{propia['id']}/leer/").json()["leida"] is True
    assert cliente.get(f"{URL}?estado=no_leidas").json()["count"] == 0
    assert _cliente(beto, empresa).get(f"{URL}resumen/").json()["no_leidas"] == 1


def test_el_filtro_por_modulo_y_marcar_todas(empresa):
    ana = _usuario("ana", empresa)
    with usando_empresa(empresa):
        services.notificar([ana], tipo="soporte.ticket_asignado", titulo="A")
        services.notificar([ana], tipo="matriz.recordatorio", titulo="B")
    cliente = _cliente(ana, empresa)
    assert cliente.get(f"{URL}?modulo=matriz").json()["count"] == 1
    assert cliente.post(f"{URL}leer-todas/").json()["marcadas"] == 2
    assert cliente.get(f"{URL}resumen/").json()["no_leidas"] == 0


def test_lo_de_otra_empresa_no_se_ve_en_esta(empresa):
    otra = Empresa.objects.create(nombre="LaarSeguridad", codigo="LS")
    ana = _usuario("ana", empresa)
    MembresiaEmpresa.objects.create(usuario=ana, empresa=otra)
    services.notificar([ana], tipo="soporte.x", titulo="De LS", empresa=otra)
    services.notificar([ana], tipo="soporte.x", titulo="De LC", empresa=empresa)
    titulos = [n["titulo"] for n in _cliente(ana, empresa).get(URL).json()["results"]]
    assert titulos == ["De LC"]


def test_las_viejas_se_limpian(empresa):
    ana = _usuario("ana", empresa)
    services.notificar([ana], tipo="soporte.x", titulo="Vieja leída", empresa=empresa)
    services.notificar([ana], tipo="soporte.x", titulo="Reciente", empresa=empresa)
    vieja = Notificacion.objects.todas().get(titulo="Vieja leída")
    Notificacion.objects.todas().filter(pk=vieja.pk).update(
        leida_en=timezone.now(), created_at=timezone.now() - timedelta(days=100)
    )
    assert services.limpiar() == 1
    assert list(Notificacion.objects.todas().values_list("titulo", flat=True)) == ["Reciente"]
