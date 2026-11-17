"""Un registro que no existe se dice en español (16/11/2026).

Reporte del usuario: las solicitudes y órdenes inexistentes mostraban
«No Solicitud matches the given query.», el texto de Django en inglés con el
nombre del modelo. El manejador central lo traduce para toda la API.
"""

import pytest
from django.http import Http404
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient

from apps.core.exceptions import MENSAJE_NO_ENCONTRADO, api_exception_handler
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def cliente():
    admin = User.objects.create_superuser(
        username="admin_404", email="admin_404@grupolaar.com", password="Sup3r-Secr3t!"
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.mark.parametrize("ruta", ["/api/v1/solicitudes/999999/", "/api/v1/ordenes/999999/"])
def test_una_solicitud_u_orden_que_no_existe_se_dice_en_espanol(cliente, ruta):
    respuesta = cliente.get(ruta)

    assert respuesta.status_code == 404
    texto = str(respuesta.json())
    assert MENSAJE_NO_ENCONTRADO in texto
    assert "matches the given query" not in texto


def test_el_manejador_traduce_los_404_tecnicos_y_respeta_los_propios():
    contexto = {"request": None, "view": None}
    for tecnico in (
        Http404("No Solicitud matches the given query."),
        NotFound("No Orden matches the given query."),
        NotFound(),
    ):
        respuesta = api_exception_handler(tecnico, contexto)
        assert respuesta.status_code == 404
        assert MENSAJE_NO_ENCONTRADO in str(respuesta.data)

    propio = api_exception_handler(NotFound("El archivo ya no está disponible."), contexto)
    assert "El archivo ya no está disponible." in str(propio.data)
    propio_django = api_exception_handler(
        Http404("El archivo ya no está disponible en el servidor."), contexto
    )
    assert "El archivo ya no está disponible en el servidor." in str(propio_django.data)

    # Lo que no es un 404 no cambia.
    otro = api_exception_handler(ValidationError({"nombre": ["Obligatorio."]}), contexto)
    assert otro.status_code == 400
    assert MENSAJE_NO_ENCONTRADO not in str(otro.data)
