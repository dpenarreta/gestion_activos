"""Todo acceso pasa por un permiso (21/10/2026).

Lo que antes bastaba con tener sesión —consultar el propio rol de pagos,
reportar sugerencias, solicitar permisos— y lo que estaba
reservado al superusuario en los dashboards ahora pide su permiso. Los roles
de nivel del organigrama traen los de todo empleado. El chat y Soporte TI
siguen siendo de todo usuario, sin permiso.
"""

import pytest
from rest_framework.test import APIClient

from apps.organizacion.roles_de_cargo import PERMISOS_BASE
from apps.organizacion.tests.test_carga_personas import _cuenta
from apps.permissions.catalog import all_codenames

pytestmark = pytest.mark.django_db


def test_los_permisos_nuevos_estan_en_el_catalogo():
    catalogo = set(all_codenames())
    nuevos = {
        "licencias.solicitar",
        "roles_pago.consultar",
        "sugerencias.reportar",
        "dashboard.reasignar_dueno",
        "dashboard.administrar_acceso",
        "dashboard.desbloquear",
    }
    assert nuevos <= catalogo
    assert set(PERMISOS_BASE) <= catalogo


@pytest.mark.parametrize(
    "metodo, ruta",
    [
        ("get", "/api/v1/nomina/rol-pagos/"),
        ("get", "/api/v1/licencias/tipos/"),
        ("get", "/api/v1/licencias/opciones/"),
        ("post", "/api/v1/sugerencias/reportes/"),
    ],
)
def test_sin_permiso_lo_de_todo_empleado_se_niega(db, metodo, ruta):
    _, cliente = _cuenta("sinpermisos")
    respuesta = getattr(cliente, metodo)(ruta, {}, format="json")
    assert respuesta.status_code == 403, (ruta, respuesta.status_code)


def test_el_chat_y_soporte_ti_son_de_todo_usuario_aunque_no_tenga_permisos(db):
    """Decisión del 21/10/2026: cualquiera, tenga el rol que tenga."""
    _, cliente = _cuenta("sinrol")
    assert cliente.get("/api/v1/soporte/solicitar/").status_code == 200
    assert cliente.get("/api/v1/soporte/mis-tickets/").status_code == 200
    assert cliente.get("/api/v1/chat/conversaciones/").status_code == 200


def test_con_los_permisos_base_entra(db):
    _, cliente = _cuenta("empleada", *PERMISOS_BASE)
    assert cliente.get("/api/v1/nomina/rol-pagos/").status_code == 200
    assert cliente.get("/api/v1/licencias/tipos/").status_code == 200
    # Las opciones listan a toda la empresa: no son de todo empleado.
    assert cliente.get("/api/v1/licencias/opciones/").status_code == 403


def test_reasignar_el_duenio_de_un_dashboard_pide_su_permiso(db):
    _, cliente = _cuenta("analista", "dashboard.view")
    respuesta = cliente.patch("/api/v1/dashboards/cualquiera/dueno", {"owner_id": 1}, format="json")
    assert respuesta.status_code == 403
