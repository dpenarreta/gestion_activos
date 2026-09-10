"""Cobertura de tests/qa/features/hallazgos-de-seguridad.feature (AC-SEC-012)."""

import pytest
from rest_framework.test import APIClient

from apps.core.csp import POLITICA


@pytest.mark.django_db
def test_toda_respuesta_declara_su_politica_de_contenido():
    """El token vive en `localStorage`: sin CSP, cualquier XSS futuro se lo lleva."""
    respuesta = APIClient().get("/api/v1/health/")

    politica = respuesta["Content-Security-Policy"]
    assert "default-src 'none'" in politica
    assert "'unsafe-inline'" not in politica.split("style-src")[0]
    assert "frame-ancestors 'none'" in politica


@pytest.mark.django_db
def test_no_pisa_la_politica_que_ya_venga_puesta(settings):
    """Un proxy o el servidor de estáticos pueden imponer la suya, más ajustada."""
    from django.http import HttpResponse

    from apps.core.csp import ContentSecurityPolicyMiddleware

    def vista(request):
        respuesta = HttpResponse()
        respuesta["Content-Security-Policy"] = "default-src 'self'"
        return respuesta

    resultado = ContentSecurityPolicyMiddleware(vista)(None)

    assert resultado["Content-Security-Policy"] == "default-src 'self'"


def test_la_politica_por_defecto_obliga_a_declarar_cada_recurso():
    """`default-src 'none'` hace que lo que no está escrito no cargue."""
    assert POLITICA.startswith("default-src 'none'")
