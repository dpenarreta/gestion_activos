"""El comando que pone la clave temporal a las cuentas activas (26/10/2026).

Sin `--confirmar` no cambia nada; con él, a cada cuenta activa (menos las
exceptuadas) le pone la clave temporal del entorno, le exige cambiarla y le
cierra las sesiones. Las deshabilitadas no se tocan. Sin clave temporal
configurada, no hace nada.
"""

from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.authentication.models import Session
from apps.users.models import User

pytestmark = pytest.mark.django_db

TEMPORAL = "Clave-De-Prueba9!"


@pytest.fixture(autouse=True)
def _con_clave_temporal(settings):
    settings.CLAVE_INICIAL_USUARIOS = TEMPORAL


def _cuenta(nombre, **extra):
    return User.objects.create_user(
        username=nombre, email=f"{nombre}@grupolaar.com", password="Propia-2026!", **extra
    )


def _correr(*args):
    salida = StringIO()
    call_command("restablecer_clave_temporal", *args, stdout=salida)
    return salida.getvalue()


def test_sin_confirmar_solo_lista():
    ana = _cuenta("ana")
    salida = _correr("--excepto", "yo@grupolaar.com")
    assert "ana <ana@grupolaar.com>" in salida
    assert "vuelva a correrlo con --confirmar" in salida
    ana.refresh_from_db()
    assert ana.check_password("Propia-2026!") and not ana.must_change_password


def test_confirmado_pone_la_temporal_exige_el_cambio_y_cierra_sesiones():
    ana, beto, yo = _cuenta("ana"), _cuenta("beto"), _cuenta("yo")
    fuera = _cuenta("fuera")
    fuera.status = User.Status.DISABLED
    fuera.save()
    sesion = Session.objects.create(user=ana, expires_at=timezone.now() + timedelta(days=1))

    salida = _correr("--excepto", "YO@grupolaar.com", "--confirmar")

    for u in (ana, beto):
        u.refresh_from_db()
        assert u.check_password(TEMPORAL)
        assert u.must_change_password
    sesion.refresh_from_db()
    assert sesion.revoked_at is not None
    # La exceptuada y la deshabilitada quedan como estaban.
    for u in (yo, fuera):
        u.refresh_from_db()
        assert u.check_password("Propia-2026!") and not u.must_change_password
    assert "Se dejan como están: yo." in salida
    # La clave nunca se imprime.
    assert TEMPORAL not in salida


def test_sin_clave_temporal_configurada_no_hace_nada(settings):
    settings.CLAVE_INICIAL_USUARIOS = ""
    ana = _cuenta("ana")
    with pytest.raises(CommandError):
        _correr("--confirmar")
    ana.refresh_from_db()
    assert ana.check_password("Propia-2026!")
