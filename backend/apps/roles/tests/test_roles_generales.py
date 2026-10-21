"""Un solo catálogo de roles para todo el sistema (15 de octubre de 2026).

Los roles de la Matriz se fundieron en los generales: ninguno es propio de un
módulo, y los permisos de la Matriz cuentan igual que los demás. Desde el
21/10/2026 los roles son los cargos del organigrama, más Administrador y
Superusuario.
"""

import pytest
from django.contrib.auth.models import Group

pytestmark = pytest.mark.django_db


def _matriz(nombre):
    return set(
        Group.objects.get(name=nombre)
        .permissions.filter(codename__startswith="matriz.")
        .values_list("codename", flat=True)
    )


def test_administrador_y_superusuario_traen_toda_la_matriz():
    assert len(_matriz("Administrador")) == 12
    assert len(_matriz("Superusuario")) == 12


def test_no_queda_ningun_rol_propio_de_un_modulo():
    assert not Group.objects.filter(name__startswith="Matriz ·").exists()
