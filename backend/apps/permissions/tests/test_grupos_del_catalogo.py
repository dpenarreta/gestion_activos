"""Cada permiso dice a qué parte del sistema pertenece.

El catálogo creció de los permisos transversales a tres módulos de negocio.
Para asignarlos con criterio hay que saber, de cada uno, si vale en todo el
sistema o solo dentro de un módulo: eso es `MODULE_GROUPS`.
"""

from rest_framework.test import APIClient

from apps.permissions.catalog import MODULE_GROUPS, PERMISSION_CATALOG
from apps.users.models import User


def test_todo_bloque_del_catalogo_esta_en_un_solo_grupo():
    agrupados = [clave for grupo in MODULE_GROUPS for clave in grupo["modules"]]
    assert sorted(agrupados) == sorted(PERMISSION_CATALOG), "bloque sin grupo o inexistente"
    assert len(agrupados) == len(set(agrupados)), "bloque en dos grupos"


def test_cada_bloque_lleva_su_grupo_y_el_catalogo_sigue_el_orden_de_los_grupos():
    ordenes = [modulo["grupo"]["orden"] for modulo in PERMISSION_CATALOG.values()]
    assert ordenes == sorted(ordenes)
    assert PERMISSION_CATALOG["activos"]["grupo"]["id"] == "activos"
    assert PERMISSION_CATALOG["matriz"]["grupo"]["id"] == "matriz"
    assert PERMISSION_CATALOG["dashboard"]["grupo"]["id"] == "dashboards"


def test_lo_general_son_las_secciones_del_bloque_general_del_menu():
    """Reportes, Auditoría y Configuración —con lo que se administra desde
    ella, como los catálogos— son del sistema, no de un módulo."""
    generales = [g["id"] for g in MODULE_GROUPS if g["alcance"] == "general"]
    assert generales == ["reportes", "auditoria", "configuracion"]
    for clave, seccion in {
        "reportes": "reportes",
        "auditoria": "auditoria",
        "usuarios": "configuracion",
        "empresas": "configuracion",
        "organizacion": "configuracion",
        "catalogos": "configuracion",
        "configuracion": "configuracion",
    }.items():
        assert PERMISSION_CATALOG[clave]["grupo"]["id"] == seccion, clave
        assert PERMISSION_CATALOG[clave]["grupo"]["alcance"] == "general"


def test_configurar_las_alertas_es_de_configuracion_y_verlas_del_modulo():
    """La pantalla de configurar alertas vive en Configuración → Notificaciones;
    la de verlas, en el módulo de Gestión de Activos."""
    assert "notificaciones.configurar" in PERMISSION_CATALOG["notificaciones"]["permissions"]
    assert PERMISSION_CATALOG["notificaciones"]["grupo"]["id"] == "configuracion"
    assert list(PERMISSION_CATALOG["alertas"]["permissions"]) == ["alertas.ver"]
    assert PERMISSION_CATALOG["alertas"]["grupo"]["id"] == "activos"


def test_la_api_entrega_el_grupo_de_cada_bloque(db):
    usuario = User.objects.create_user(
        username="lector", email="lector@example.com", password="Sup3r-Secr3t!", is_superuser=True
    )
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)

    datos = cliente.get("/api/v1/admin/permissions/").json()

    assert datos["matriz"]["grupo"]["label"] == "Matriz de obligaciones"
    assert list(datos)[0] == "reportes"
