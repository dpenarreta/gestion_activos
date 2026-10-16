"""Configuración → Notificaciones → Correo del sistema.

Dice por dónde sale el correo (sin la clave) y deja enviar una prueba al buzón
de quien la pide, y a nadie más.
"""

import pytest
from django.contrib.auth.models import Permission
from django.core import mail
from rest_framework.test import APIClient

from apps.core.models import AuditLog
from apps.users.models import User

pytestmark = pytest.mark.django_db

URL = "/api/v1/configuracion/correo/"


def _cliente(*codigos, email="ana@example.com"):
    usuario = User.objects.create_user(username="ana", email=email, password="Sup3r-Secr3t!")
    usuario.user_permissions.set(
        Permission.objects.filter(content_type__app_label="permissions", codename__in=codigos)
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


def test_dice_por_donde_sale_el_correo_sin_la_clave(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = "smtp.example.com"
    settings.EMAIL_PORT = 2524
    settings.EMAIL_USE_TLS = True
    settings.EMAIL_HOST_PASSWORD = "no-debe-salir"
    respuesta = _cliente("configuracion.ver").get(URL)
    assert respuesta.status_code == 200
    assert respuesta.data["servidor"] == "smtp.example.com"
    assert respuesta.data["puerto"] == 2524
    assert respuesta.data["cifrado"] == "STARTTLS"
    assert respuesta.data["envia_de_verdad"] is True
    assert "no-debe-salir" not in str(respuesta.data)


def test_sin_permiso_no_se_ve():
    assert _cliente().get(URL).status_code == 403


def test_la_prueba_va_solo_a_quien_la_pide():
    respuesta = _cliente("configuracion.ver", "configuracion.editar").post(f"{URL}prueba/")
    assert respuesta.status_code == 200
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["ana@example.com"]
    assert mail.outbox[0].subject.startswith("[PRUEBA]")
    assert AuditLog.objects.filter(action="correo.prueba_enviada").exists()


def test_la_prueba_exige_editar_la_configuracion():
    assert _cliente("configuracion.ver").post(f"{URL}prueba/").status_code == 403


def test_sin_correo_registrado_lo_dice():
    respuesta = _cliente("configuracion.ver", "configuracion.editar", email="").post(
        f"{URL}prueba/"
    )
    assert respuesta.status_code == 400


def test_un_fallo_del_servidor_se_devuelve_legible(monkeypatch):
    def fallar(self, fail_silently=False):
        raise ConnectionRefusedError("SMTP no responde")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", fallar)
    respuesta = _cliente("configuracion.ver", "configuracion.editar").post(f"{URL}prueba/")
    assert respuesta.status_code == 502
    assert "SMTP no responde" in respuesta.data["motivo"]
