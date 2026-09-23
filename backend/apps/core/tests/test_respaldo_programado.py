"""Cuándo se respalda solo.

Cobertura de tests/qa/features/respaldos.feature (AC-RES-010 a AC-RES-018).

Lo que se prueba aquí no es que el respaldo funcione —eso es `test_respaldos`—
sino **que se haga solo el día que toca y no el resto**. Un respaldo automático
que no corre no avisa: el sistema sigue funcionando y el hueco solo se descubre
el día que hay que volver a algún sitio.
"""

import datetime

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import PoliticaDeRespaldo
from apps.permissions.models import ModulePermission
from apps.users.models import User

pytestmark = pytest.mark.django_db

RUTA = "/api/v1/configuracion/respaldos/"


def _momento(dia: str, hora: str) -> datetime.datetime:
    """Un instante concreto en la zona del sistema."""
    fecha = datetime.date.fromisoformat(dia)
    reloj = datetime.time.fromisoformat(hora)
    return timezone.make_aware(datetime.datetime.combine(fecha, reloj))


# --- Cuándo toca -------------------------------------------------------------


def test_apagado_no_toca_nunca():
    politica = PoliticaDeRespaldo(activo=False, hora=datetime.time(2, 0))

    assert not politica.toca_respaldar(_momento("2026-09-18", "03:00"))


def test_diaria_toca_pasada_la_hora():
    politica = PoliticaDeRespaldo(activo=True, hora=datetime.time(2, 0))

    assert not politica.toca_respaldar(_momento("2026-09-18", "01:59"))
    assert politica.toca_respaldar(_momento("2026-09-18", "02:00"))


def test_no_se_repite_el_mismo_dia():
    """La tarea corre cada hora: sin esta marca haría un respaldo por hora desde
    las dos de la mañana."""
    politica = PoliticaDeRespaldo(
        activo=True, hora=datetime.time(2, 0), ultimo_respaldo=datetime.date(2026, 9, 18)
    )

    assert not politica.toca_respaldar(_momento("2026-09-18", "05:00"))
    assert politica.toca_respaldar(_momento("2026-09-19", "05:00"))


def test_semanal_solo_su_dia():
    # 2026-09-18 es viernes; 2026-09-21, lunes.
    politica = PoliticaDeRespaldo(
        activo=True,
        frecuencia=PoliticaDeRespaldo.Frecuencia.SEMANAL,
        dia_semanal=0,
        hora=datetime.time(2, 0),
    )

    assert not politica.toca_respaldar(_momento("2026-09-18", "03:00"))
    assert politica.toca_respaldar(_momento("2026-09-21", "03:00"))


# --- El comando --------------------------------------------------------------


def test_si_toca_no_hace_nada_con_el_respaldo_apagado(capsys, tmp_path):
    PoliticaDeRespaldo.objects.create(activo=False)

    call_command("respaldar", "--si-toca", "--destino", str(tmp_path))

    salida = capsys.readouterr().out
    assert "apagado" in salida
    assert list(tmp_path.iterdir()) == []


def test_si_toca_dice_por_que_no_toca(capsys, tmp_path):
    """La tarea corre cada hora y su salida es lo único que alguien mirará el
    día que pregunte por qué no hay respaldos."""
    PoliticaDeRespaldo.objects.create(
        activo=True, ultimo_respaldo=timezone.localdate(), destino=str(tmp_path)
    )

    call_command("respaldar", "--si-toca", "--destino", str(tmp_path))

    assert "Ya hay respaldo de hoy" in capsys.readouterr().out


def test_cuando_toca_respalda_y_lo_anota(tmp_path):
    """Anotarlo es lo que evita el segundo respaldo de la hora siguiente."""
    politica = PoliticaDeRespaldo.objects.create(
        activo=True, hora=datetime.time(0, 1), destino=str(tmp_path)
    )

    call_command("respaldar", "--si-toca", "--solo-adjuntos", "--destino", str(tmp_path))

    politica.refresh_from_db()
    assert politica.ultimo_respaldo == timezone.localdate()
    assert list(tmp_path.glob("manifiesto-*.json"))


def test_la_carpeta_sale_de_la_politica(tmp_path):
    """Quien programó la tarea no tiene por qué saber dónde quiere la carpeta
    quien administra el sistema."""
    PoliticaDeRespaldo.objects.create(
        activo=True, hora=datetime.time(0, 1), destino=str(tmp_path / "elegida")
    )

    call_command("respaldar", "--si-toca", "--solo-adjuntos")

    assert list((tmp_path / "elegida").glob("manifiesto-*.json"))


def test_se_retiran_los_respaldos_viejos(tmp_path):
    """Sin esto el disco se llena, y el respaldo empieza a fallar justo cuando
    más falta hace."""
    for marca in ("20260101-0200", "20260102-0200", "20260103-0200"):
        (tmp_path / f"manifiesto-{marca}.json").write_text("{}", encoding="utf-8")
        (tmp_path / f"adjuntos-{marca}.tar.gz").write_bytes(b"x")
    PoliticaDeRespaldo.objects.create(
        activo=True, hora=datetime.time(0, 1), destino=str(tmp_path), conservar=2
    )

    call_command("respaldar", "--si-toca", "--solo-adjuntos", "--destino", str(tmp_path))

    manifiestos = sorted(p.name for p in tmp_path.glob("manifiesto-*.json"))
    assert len(manifiestos) == 2, manifiestos
    # Se va el más viejo con sus hermanos, no solo su manifiesto.
    assert not (tmp_path / "adjuntos-20260101-0200.tar.gz").exists()


def test_a_mano_no_cuenta_como_el_programado(tmp_path):
    """Lanzar uno de prueba un martes no puede saltarse el programado del
    miércoles sin que nadie lo note."""
    politica = PoliticaDeRespaldo.objects.create(
        activo=True, hora=datetime.time(0, 1), destino=str(tmp_path)
    )

    call_command("respaldar", "--solo-adjuntos", "--destino", str(tmp_path))

    politica.refresh_from_db()
    assert politica.ultimo_respaldo is None


# --- La pantalla -------------------------------------------------------------


@pytest.fixture
def administrador(db):
    usuario = User.objects.create_user(
        username="config", email="config@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=["configuracion.ver", "configuracion.editar"],
        )
    )
    return usuario


@pytest.fixture
def cliente(administrador):
    api = APIClient()
    api.force_authenticate(user=administrador)
    return api


def test_la_politica_se_lee_y_se_corrige(cliente):
    respuesta = cliente.patch(
        RUTA,
        {"activo": True, "frecuencia": "semanal", "dia_semanal": 2, "hora": "03:15"},
        format="json",
    )

    assert respuesta.status_code == 200, respuesta.data
    politica = PoliticaDeRespaldo.vigente()
    assert politica.activo and politica.frecuencia == "semanal"
    assert politica.hora == datetime.time(3, 15)


def test_la_pantalla_dice_cuando_sera_el_proximo(cliente):
    """Es la comprobación que alguien hace después de cambiar la frecuencia: sin
    eso hay que esperar al día siguiente para saber si quedó bien."""
    respuesta = cliente.patch(RUTA, {"activo": True, "hora": "23:59"}, format="json")

    assert respuesta.data["proximo"], respuesta.data
    assert respuesta.data["proximo"].endswith("23:59")


def test_conservar_cero_se_rechaza(cliente):
    respuesta = cliente.patch(RUTA, {"conservar": 0}, format="json")

    assert respuesta.status_code == 400
    assert "al menos uno" in str(respuesta.data)


def test_sin_permiso_no_se_toca(db):
    ajeno = User.objects.create_user(
        username="ajeno_resp", email="ajeno_resp@example.com", password="Sup3r-Secr3t!"
    )
    api = APIClient()
    api.force_authenticate(user=ajeno)

    assert api.get(RUTA).status_code == 403
    assert api.patch(RUTA, {"activo": True}, format="json").status_code == 403


def test_el_cambio_queda_auditado(cliente):
    """Quién dejó de respaldar, y cuándo, es lo primero que se pregunta el día
    que hace falta volver a algún sitio."""
    from apps.core.models import AuditLog

    cliente.patch(RUTA, {"activo": True}, format="json")

    evento = AuditLog.objects.filter(action="respaldo.politica_changed").first()
    assert evento is not None
    assert evento.new_values["activo"] is True
