"""Un solo catálogo de roles para todo el sistema (15 de octubre de 2026).

Los roles de la Matriz se fundieron en los generales: ninguno es propio de un
módulo, y los permisos de la Matriz cuentan igual que los demás.
"""

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command

pytestmark = pytest.mark.django_db


def _matriz(nombre):
    return set(
        Group.objects.get(name=nombre)
        .permissions.filter(codename__startswith="matriz.")
        .values_list("codename", flat=True)
    )


def test_los_roles_generales_traen_la_matriz():
    assert len(_matriz("Administrador")) == 12
    assert _matriz("Consulta / Auditoría") == {
        "matriz.ver_todas",
        "matriz.exportar",
        "matriz.ver_auditoria",
    }
    assert "matriz.validar" in _matriz("Supervisor de cumplimiento")
    assert "matriz.cargar" in _matriz("Responsable de cumplimiento")


def test_no_queda_ningun_rol_propio_de_un_modulo():
    assert not Group.objects.filter(name__startswith="Matriz ·").exists()


def test_la_plantilla_de_roles_incluye_los_de_cumplimiento():
    """`crear_roles_iniciales` es la definición del catálogo general: con
    `--actualizar` deja los de cumplimiento como dice la tabla."""
    call_command("crear_roles_iniciales", "--actualizar", verbosity=0)
    assert _matriz("Responsable de cumplimiento") == {
        "matriz.crear",
        "matriz.editar",
        "matriz.cargar",
        "matriz.enviar",
        "matriz.recordar",
    }
    supervisor = _matriz("Supervisor de cumplimiento")
    assert "matriz.cargar" not in supervisor and "matriz.enviar" not in supervisor
