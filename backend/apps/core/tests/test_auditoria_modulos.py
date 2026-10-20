"""El filtro «Módulo» de la auditoría unificada (20/10/2026): la lista de
módulos con eventos, con su nombre legible, y el filtro por módulo."""

from rest_framework.test import APIClient

from apps.core.audit import record_audit_event
from apps.users.models import User

URL = "/api/v1/admin/audit-logs/"


def test_los_modulos_con_eventos_y_el_filtro(db):
    usuario = User.objects.create_superuser(
        username="ines", email="ines@grupolaar.com", password="Sup3r-Secr3t!"
    )
    for modulo in ("activos", "soporte", "activos"):
        record_audit_event(actor=usuario, action=f"{modulo}.probado", target=usuario, module=modulo)
    cliente = APIClient()
    cliente.force_authenticate(user=usuario)
    modulos = {m["id"]: m["nombre"] for m in cliente.get(f"{URL}modulos/").json()}
    assert modulos["activos"] == "Gestión de Activos"
    assert modulos["soporte"] == "Mesa de ayuda"
    filtrados = cliente.get(URL, {"module": "soporte"}).json()
    lista = filtrados.get("results", filtrados)
    assert {e["module_nombre"] for e in lista} == {"Mesa de ayuda"}
