"""Los textos de la pantalla de acceso se personalizan (17/11/2026)."""

import pytest
from rest_framework.test import APIClient

from apps.branding.catalog import DEFAULT_THEME
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin():
    usuario = User.objects.create_superuser(
        username="admin_marca", email="admin_marca@grupolaar.com", password="Sup3r-Secr3t!"
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    return cliente


def test_el_tema_publico_trae_los_textos_por_defecto():
    datos = APIClient().get("/api/v1/theme/current/").json()
    assert datos["acceso_lema"] == DEFAULT_THEME["acceso_lema"]
    assert datos["acceso_titulo"] == "Acceso al sistema"


def test_se_cambian_y_se_ven_sin_iniciar_sesion(admin):
    respuesta = admin.patch(
        "/api/v1/admin/theme/",
        {"acceso_lema": "Bienvenido a la Intranet LCE", "acceso_pie": ""},
        format="json",
    )
    assert respuesta.status_code == 200, respuesta.content

    publico = APIClient().get("/api/v1/theme/current/").json()
    assert publico["acceso_lema"] == "Bienvenido a la Intranet LCE"
    assert publico["acceso_pie"] == ""


def test_el_lema_y_el_titulo_no_pueden_quedar_vacios_ni_pasarse_de_largo(admin):
    assert (
        admin.patch("/api/v1/admin/theme/", {"acceso_lema": ""}, format="json").status_code == 400
    )
    assert (
        admin.patch("/api/v1/admin/theme/", {"acceso_titulo": "x" * 81}, format="json").status_code
        == 400
    )


def test_restablecer_vuelve_a_los_textos_de_siempre(admin):
    admin.patch("/api/v1/admin/theme/", {"acceso_lema": "Otro lema"}, format="json")
    admin.post("/api/v1/admin/theme/reset/")
    assert (
        APIClient().get("/api/v1/theme/current/").json()["acceso_lema"]
        == DEFAULT_THEME["acceso_lema"]
    )
