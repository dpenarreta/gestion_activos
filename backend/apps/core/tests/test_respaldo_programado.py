"""Cuándo se respalda solo.

Cobertura de tests/qa/features/respaldos.feature (AC-BAK-009 a AC-BAK-021).

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


def _politica(**campos) -> PoliticaDeRespaldo:
    datos = {"activo": True, "dias": [0, 1, 2, 3, 4, 5, 6], "horas": ["02:00"]}
    datos.update(campos)
    return PoliticaDeRespaldo(**datos)


def test_de_fabrica_respalda_todos_los_dias_a_las_17():
    """Encendido y al final de la jornada: un sistema recién instalado sin
    respaldo no avisa de nada hasta el día que hace falta."""
    politica = PoliticaDeRespaldo.vigente()

    assert politica.activo is True
    assert politica.dias == [0, 1, 2, 3, 4, 5, 6]
    assert politica.horas == ["17:00"]


def test_apagado_no_toca_nunca():
    assert not _politica(activo=False).toca_respaldar(_momento("2026-09-18", "03:00"))


def test_toca_pasada_la_hora():
    politica = _politica()

    assert not politica.toca_respaldar(_momento("2026-09-18", "01:59"))
    assert politica.toca_respaldar(_momento("2026-09-18", "02:00"))


def test_la_hora_es_la_local_y_no_utc():
    """«02:30» en pantalla es las 02:30 de Ecuador. Con UTC eran las 21:30 del
    día anterior, y el sistema no respaldaba a la hora que decía."""
    from django.conf import settings

    assert settings.TIME_ZONE == "America/Guayaquil"
    turno = _politica(horas=["02:30"]).turno_pendiente(_momento("2026-09-18", "02:31"))
    assert timezone.localtime(turno).strftime("%H:%M") == "02:30"


def test_un_turno_no_se_repite():
    """La tarea pasa cada pocos minutos: sin esta marca haría un respaldo por
    pasada desde las dos de la mañana."""
    politica = _politica(ultimo_programado=_momento("2026-09-18", "02:00"))

    assert not politica.toca_respaldar(_momento("2026-09-18", "05:00"))
    assert politica.toca_respaldar(_momento("2026-09-19", "05:00"))


def test_varias_horas_al_dia_hacen_varios_respaldos():
    politica = _politica(horas=["13:00", "22:00"])

    assert politica.turno_pendiente(_momento("2026-09-18", "13:05")) == _momento(
        "2026-09-18", "13:00"
    )
    politica.ultimo_programado = _momento("2026-09-18", "13:00")
    assert not politica.toca_respaldar(_momento("2026-09-18", "21:59"))
    assert politica.turno_pendiente(_momento("2026-09-18", "22:00")) == _momento(
        "2026-09-18", "22:00"
    )


def test_turnos_perdidos_se_cubren_con_uno_solo():
    """Con el equipo apagado a las 13:00 y a las 22:00, al encenderse se hace
    un respaldo, no dos seguidos con el mismo contenido."""
    politica = _politica(horas=["13:00", "22:00"])

    assert politica.turno_pendiente(_momento("2026-09-18", "23:30")) == _momento(
        "2026-09-18", "22:00"
    )


def test_solo_los_dias_elegidos():
    # 2026-09-18 es viernes; 2026-09-19, sábado; 2026-09-21, lunes.
    politica = _politica(dias=[0, 1, 2, 3, 4])

    assert politica.toca_respaldar(_momento("2026-09-18", "03:00"))
    assert not politica.toca_respaldar(_momento("2026-09-19", "03:00"))
    assert politica.toca_respaldar(_momento("2026-09-21", "03:00"))


def test_el_proximo_salta_los_dias_no_elegidos():
    politica = _politica(dias=[0], horas=["08:00"])

    # Viernes por la tarde: el próximo es el lunes a las 08:00.
    assert politica.proximo_turno(_momento("2026-09-18", "15:00")) == _momento(
        "2026-09-21", "08:00"
    )


# --- El comando --------------------------------------------------------------


def test_si_toca_no_hace_nada_con_el_respaldo_apagado(capsys, tmp_path):
    PoliticaDeRespaldo.objects.create(activo=False)

    call_command("respaldar", "--si-toca", "--destino", str(tmp_path))

    salida = capsys.readouterr().out
    assert "apagado" in salida
    assert list(tmp_path.iterdir()) == []


def test_si_toca_dice_por_que_no_toca(capsys, tmp_path):
    """La tarea corre cada pocos minutos y su salida es lo único que alguien
    mirará el día que pregunte por qué no hay respaldos."""
    ahora = timezone.localtime()
    PoliticaDeRespaldo.objects.create(
        activo=True,
        horas=["00:00"],
        ultimo_programado=timezone.make_aware(
            datetime.datetime.combine(ahora.date(), datetime.time(0, 0))
        ),
        destino=str(tmp_path),
    )

    call_command("respaldar", "--si-toca", "--destino", str(tmp_path))

    assert "Ya hay respaldo del ultimo turno" in capsys.readouterr().out


def test_cuando_toca_respalda_y_lo_anota(tmp_path):
    """Anotar el turno es lo que evita el segundo respaldo de la pasada
    siguiente; anotar el resultado, lo que deja ver si falló."""
    politica = PoliticaDeRespaldo.objects.create(
        activo=True, horas=["00:00"], destino=str(tmp_path), ultimo_error="viejo"
    )

    call_command("respaldar", "--si-toca", "--solo-adjuntos", "--destino", str(tmp_path))

    politica.refresh_from_db()
    assert timezone.localtime(politica.ultimo_programado).date() == timezone.localdate()
    assert politica.ultima_ejecucion is not None
    assert politica.ultimo_error == ""
    assert list(tmp_path.glob("manifiesto-*.json"))


def test_la_carpeta_sale_de_la_politica(tmp_path):
    """Quien programó la tarea no tiene por qué saber dónde quiere la carpeta
    quien administra el sistema."""
    PoliticaDeRespaldo.objects.create(
        activo=True, horas=["00:00"], destino=str(tmp_path / "elegida")
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
        activo=True, horas=["00:00"], destino=str(tmp_path), conservar=2
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
        activo=True, horas=["00:00"], destino=str(tmp_path)
    )

    call_command("respaldar", "--solo-adjuntos", "--destino", str(tmp_path))

    politica.refresh_from_db()
    assert politica.ultimo_programado is None


def test_lo_pedido_desde_la_pantalla_se_hace_aunque_este_apagado(tmp_path):
    """«Respaldar ahora» es una orden, no una preferencia: vale también con el
    automático apagado —antes de una migración arriesgada, por ejemplo—."""
    politica = PoliticaDeRespaldo.objects.create(
        activo=False, destino=str(tmp_path), solicitado_en=timezone.now()
    )

    call_command("respaldar", "--si-toca", "--solo-adjuntos")

    politica.refresh_from_db()
    assert list(tmp_path.glob("manifiesto-*.json"))
    assert politica.solicitado_en is None
    # No cuenta como un turno: el programado de esta noche se hace igual.
    assert politica.ultimo_programado is None


def test_un_fallo_queda_anotado(tmp_path, monkeypatch):
    """Un respaldo que falla todas las noches —Docker apagado, disco lleno— no
    puede quedar solo en una salida que nadie mira."""
    from django.core.management.base import CommandError

    from apps.core.management.commands import respaldar

    def _falla(*args, **kwargs):
        raise CommandError("SQL Server no respondió")

    monkeypatch.setattr(respaldar.Command, "_respaldar", _falla)
    politica = PoliticaDeRespaldo.objects.create(
        activo=True, horas=["00:00"], destino=str(tmp_path), solicitado_en=timezone.now()
    )

    with pytest.raises(CommandError):
        call_command("respaldar", "--si-toca")

    politica.refresh_from_db()
    assert "SQL Server no respondió" in politica.ultimo_error
    assert politica.ultima_ejecucion is not None
    # La orden se da por atendida: repetirla cada cinco minutos contra un
    # servidor caído solo llenaría el registro.
    assert politica.solicitado_en is None


# --- La pantalla -------------------------------------------------------------


@pytest.fixture
def administrador(db):
    usuario = User.objects.create_user(
        username="config", email="config@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=["configuracion.ver", "configuracion.respaldos"],
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
        {"activo": True, "dias": [4, 0, 2, 0], "horas": ["22:00", "13:00"]},
        format="json",
    )

    assert respuesta.status_code == 200, respuesta.data
    politica = PoliticaDeRespaldo.vigente()
    assert politica.activo
    # Ordenados y sin repetir: así se comparan contra el reloj.
    assert politica.dias == [0, 2, 4]
    assert politica.horas == ["13:00", "22:00"]


@pytest.mark.parametrize(
    "campos, motivo",
    [
        ({"dias": []}, "al menos un día"),
        ({"dias": [7]}, "0 (lunes) a 6"),
        ({"horas": []}, "al menos una hora"),
        ({"horas": ["2:00"]}, "HH:MM"),
        ({"horas": ["25:00"]}, "no es una hora válida"),
        ({"horas": [f"{h:02d}:00" for h in range(9)]}, "Como mucho 8"),
    ],
)
def test_un_horario_imposible_se_rechaza(cliente, campos, motivo):
    respuesta = cliente.patch(RUTA, campos, format="json")

    assert respuesta.status_code == 400
    assert motivo in str(respuesta.data)


def test_la_pantalla_dice_cuando_sera_el_proximo(cliente):
    """Es la comprobación que alguien hace después de cambiar la frecuencia: sin
    eso hay que esperar al día siguiente para saber si quedó bien."""
    respuesta = cliente.patch(
        RUTA, {"activo": True, "dias": [0, 1, 2, 3, 4, 5, 6], "horas": ["23:59"]}, format="json"
    )

    assert respuesta.data["proximo"], respuesta.data
    # En hora local, con su desfase: la pantalla no tiene que adivinar la zona.
    assert "T23:59:00-05:00" in respuesta.data["proximo"]
    assert respuesta.data["zona_horaria"] == "America/Guayaquil"


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

    # Apagarlo: viene encendido de fábrica, y es justo el cambio que se
    # pregunta el día que no hay respaldo.
    cliente.patch(RUTA, {"activo": False}, format="json")

    evento = AuditLog.objects.filter(action="respaldo.politica_changed").first()
    assert evento is not None
    assert evento.new_values["activo"] is False


# --- Quién puede cambiarla ---------------------------------------------------


@pytest.fixture
def solo_apariencia(db):
    """Puede configurar el sistema, pero no el respaldo.

    Es el caso que motivó separar el permiso: cambiar el logo y los colores no
    debería decidir de cuándo se puede volver si algo se pierde.
    """
    usuario = User.objects.create_user(
        username="marca", email="marca@example.com", password="Sup3r-Secr3t!"
    )
    usuario.user_permissions.set(
        Permission.objects.filter(
            content_type=ContentType.objects.get_for_model(ModulePermission),
            codename__in=["configuracion.ver", "configuracion.editar"],
        )
    )
    api = APIClient()
    api.force_authenticate(user=usuario)
    return api


def test_configurar_la_apariencia_no_habilita_a_cambiar_el_respaldo(solo_apariencia):
    politica = PoliticaDeRespaldo.vigente()
    politica.activo = True
    politica.save(update_fields=["activo"])

    respuesta = solo_apariencia.patch(RUTA, {"activo": False}, format="json")

    assert respuesta.status_code == 403
    # Y el rechazo no deja nada a medias: el respaldo sigue encendido.
    assert PoliticaDeRespaldo.vigente().activo is True


def test_pero_sí_a_leerla(solo_apariencia):
    """Ver de cuándo se puede volver es parte de ver la configuración: el dato
    no es sensible y esconderlo solo haría que se preguntara por correo."""
    respuesta = solo_apariencia.get(RUTA)

    assert respuesta.status_code == 200
    assert "horas" in respuesta.data


def test_con_el_permiso_propio_se_cambia(cliente):
    respuesta = cliente.patch(RUTA, {"activo": True, "horas": ["04:30"]}, format="json")

    assert respuesta.status_code == 200
    assert PoliticaDeRespaldo.vigente().horas == ["04:30"]


# --- Respaldar ahora ---------------------------------------------------------

RUTA_AHORA = "/api/v1/configuracion/respaldos/ahora/"


def test_respaldar_ahora_deja_la_orden_y_queda_auditado(cliente, administrador):
    """La petición no respalda —tardaría minutos y el navegador la cortaría—:
    deja la orden para la siguiente pasada de la tarea."""
    from apps.core.models import AuditLog

    respuesta = cliente.post(RUTA_AHORA)

    assert respuesta.status_code == 202
    assert respuesta.data["solicitado_en"]
    assert respuesta.data["tarea_cada_minutos"] == 5
    politica = PoliticaDeRespaldo.vigente()
    assert politica.solicitado_por == administrador
    assert AuditLog.objects.filter(action="respaldo.solicitado").count() == 1


def test_pedirlo_dos_veces_no_hace_dos(cliente):
    cliente.post(RUTA_AHORA)
    primera = PoliticaDeRespaldo.vigente().solicitado_en

    cliente.post(RUTA_AHORA)

    assert PoliticaDeRespaldo.vigente().solicitado_en == primera


def test_respaldar_ahora_exige_el_permiso_de_respaldos(solo_apariencia):
    assert solo_apariencia.post(RUTA_AHORA).status_code == 403
    assert PoliticaDeRespaldo.vigente().solicitado_en is None
