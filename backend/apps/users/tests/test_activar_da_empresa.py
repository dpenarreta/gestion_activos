"""Activar una cuenta sin empresa la deja en la empresa de su ficha
(18/11/2026).

Las cuentas que crea la sincronización con nómina nacen inactivas y sin
empresa. Activarla no bastaba: sin membresía no aparecía en la asignación de
cargos, ni en el chat, ni en ningún selector de personas.
"""

import pytest

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.organizacion.models import Empleado
from apps.users.models import User
from apps.users.services import UserAdminService

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin():
    return User.objects.create_superuser(
        username="admin", email="admin@grupolaar.com", password="Sup3r-Secr3t!"
    )


def _de_nomina(nombre):
    cuenta = User.objects.create_user(
        username=nombre, email=f"{nombre}@grupolaar.com", password="Sup3r-Secr3t!"
    )
    cuenta.status = User.Status.DISABLED
    cuenta.save()
    return cuenta


def test_al_activarla_queda_en_la_empresa_de_su_ficha(admin):
    otra = Empresa.objects.create(nombre="Otra", codigo="OTR")
    destino = Empresa.objects.create(nombre="LaarSeguridad", codigo="LSG")
    del otra
    cuenta = _de_nomina("mfierro")
    from apps.organizacion.fichas import area_pendiente

    with usando_empresa(destino):
        Empleado.objects.create(
            nombres="María del Mar",
            apellidos="Fierro",
            codigo_empleado="E-631",
            departamento=area_pendiente(destino),
            usuario=cuenta,
        )
    assert not cuenta.membresias.exists()

    UserAdminService.enable(actor=admin, user=cuenta)

    membresia = MembresiaEmpresa.objects.get(usuario=cuenta)
    assert membresia.empresa == destino
    assert membresia.es_predeterminada is True


def test_si_ya_tiene_empresa_no_se_toca(admin):
    empresa = Empresa.objects.create(nombre="LaarCourier", codigo="LCX")
    cuenta = _de_nomina("ana")
    MembresiaEmpresa.objects.create(usuario=cuenta, empresa=empresa, es_predeterminada=True)

    UserAdminService.enable(actor=admin, user=cuenta)

    assert list(cuenta.membresias.values_list("empresa_id", flat=True)) == [empresa.id]
