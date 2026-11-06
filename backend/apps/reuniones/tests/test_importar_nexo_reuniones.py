"""`manage.py importar_nexo_reuniones`: las reuniones de Nexo con sus
invitados; el enlace y la clave de Zoom pasan a ser los manuales.

Sin base de Nexo: el comando recibe un lector en memoria con los mismos métodos
que `LectorNexoReunionesSQL`. Los ids de Nexo son altos a propósito, para que
un id copiado sin traducir se note. Los correos son ficticios.
"""

import copy
from datetime import UTC, datetime
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.reuniones.models import Meeting, MeetingInvitee
from apps.reuniones.nexo.importador import es_enlace_simulado
from apps.reuniones.nexo.lector import TABLAS, LectorNexoReunionesSQL, convertir
from apps.users.models import User

from .conftest import client_for, make_user

pytestmark = pytest.mark.django_db

JEFA, ANA, NINO, PRUEBAS = 9020, 9021, 9022, 9050
USUARIOS_NEXO = [
    {"id": JEFA, "username": "jefa", "email": "Jefa.Nacional@Example.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@example.com"},
    {"id": NINO, "username": "nino", "email": "nino.noboa@example.com"},
    {"id": PRUEBAS, "username": "pruebas", "email": "pruebas@example.com"},
]
ZOOM_REAL = "https://us05web.zoom.us/j/81234567890?pwd=Xyz"


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _reunion(pk, anfitrion, **extra):
    return {
        "id": pk,
        "created_at": t(8, 1),
        "updated_at": t(8, 2),
        "title": f"Reunión {pk} — Planificación de vacaciones en Durán",
        "description": "Agenda con Óscar y Begoña",
        "host_id": anfitrion,
        "meeting_date": t(9, 10),
        "duration": 40,
        "zoom_meeting_id": "81234567890",
        "zoom_join_url": ZOOM_REAL,
        "zoom_password": "123456",
        "status": "FINALIZADA",
        "otter_invited": True,
        "otter_summary": "Se aprobó el cronograma.",
        "otter_transcript_url": "https://otter.ai/u/abc",
        **extra,
    }


def _invitado(pk, reunion, usuario, attended=False):
    return {
        "id": pk,
        "created_at": t(8, 1),
        "updated_at": t(8, 1),
        "meeting_id": reunion,
        "user_id": usuario,
        "attended": attended,
    }


def datos_nexo():
    return {
        "meeting": [
            _reunion(8001, JEFA),
            # El enlace que Nexo inventaba cuando Zoom fallaba.
            _reunion(
                8002,
                JEFA,
                zoom_meeting_id="4455667788",
                zoom_join_url="https://zoom.us/j/4455667788",
                zoom_password="AB12CD",
                status="PROGRAMADA",
                otter_summary=None,
                otter_transcript_url=None,
            ),
            # Un enlace que la intranet no acepta.
            _reunion(8003, ANA, zoom_join_url="http://intranet/sala", otter_transcript_url=None),
            _reunion(8004, PRUEBAS, zoom_join_url=None, zoom_password=None),
        ],
        "invitee": [
            _invitado(8101, 8001, ANA, attended=True),
            _invitado(8102, 8001, NINO),
            _invitado(8103, 8002, PRUEBAS),
            _invitado(8104, 8003, NINO),
            _invitado(8105, 8004, ANA),
        ],
    }


class LectorEnMemoria:
    def __init__(self, datos=None):
        self.datos = datos if datos is not None else datos_nexo()

    def filas(self, tabla):
        return copy.deepcopy(sorted(self.datos[tabla], key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in USUARIOS_NEXO if u["id"] in ids]

    def conteos(self):
        return {tabla: len(filas) for tabla, filas in self.datos.items()}


@pytest.fixture
def cuentas():
    return {
        JEFA: User.objects.create_user(username="jnacional", email="jefa.nacional@example.com"),
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
        NINO: User.objects.create_user(username="nnoboa", email="nino.noboa@example.com"),
        PRUEBAS: User.objects.create_user(username="pruebas", email="pruebas@example.com"),
    }


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_reuniones",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def test_simulacro_no_deja_nada(cuentas):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert not Meeting.objects.exists()
    assert not MeetingInvitee.objects.exists()


def test_aplicar_copia_reuniones_invitados_y_enlaces(cuentas):
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida
    assert Meeting.objects.count() == 4 and MeetingInvitee.objects.count() == 5

    real = Meeting.objects.get(title__startswith="Reunión 8001")
    assert real.empresa == empresa_actual() and real.host == cuentas[JEFA]
    assert real.join_url == ZOOM_REAL and real.join_password == "123456"
    assert real.meeting_date == t(9, 10) and real.created_at == t(8, 1)
    assert real.status == "FINALIZADA" and real.otter_summary == "Se aprobó el cronograma."
    assert real.otter_transcript_url == "https://otter.ai/u/abc"
    asistencia = {i.user_id: i.attended for i in real.invitees.all()}
    assert asistencia == {cuentas[ANA].pk: True, cuentas[NINO].pk: False}

    simulada = Meeting.objects.get(title__startswith="Reunión 8002")
    assert simulada.join_url is None and simulada.join_password is None
    assert "1 reuniones tenían el enlace simulado" in salida

    http = Meeting.objects.get(title__startswith="Reunión 8003")
    assert http.join_url is None and http.join_password is None
    assert "Enlace no importado — reunión #8003 (join_url)" in salida


def test_un_importado_se_lee_por_la_api(cuentas):
    importar("--aplicar")
    meeting = Meeting.objects.get(title__startswith="Reunión 8001")
    datos = client_for(make_user("lectora", "ANALISTA_CC")).get(
        f"/api/v1/reuniones/meetings/{meeting.pk}/"
    )
    # Quien no participa no la ve; Ana (invitada) sí.
    assert datos.status_code == 404
    from django.contrib.auth.models import Group

    cuentas[ANA].groups.set([Group.objects.get(name="ANALISTA_CC")])
    detalle = client_for(cuentas[ANA]).get(f"/api/v1/reuniones/meetings/{meeting.pk}/").json()
    assert detalle["join_url"] == ZOOM_REAL
    assert detalle["host"]["id"] == cuentas[JEFA].pk


def test_aborta_si_falta_un_usuario(cuentas):
    cuentas[PRUEBAS].delete()
    with pytest.raises(CommandError, match="Faltan 1 usuarios") as error:
        importar("--aplicar")
    assert "pruebas@example.com" in str(error.value)
    assert not Meeting.objects.exists()


def test_no_importa_dos_veces(cuentas):
    importar("--aplicar")
    with pytest.raises(CommandError, match="ya tiene reuniones"):
        importar("--aplicar")
    assert Meeting.objects.count() == 4


def test_excluir_usuario_quita_sus_reuniones_e_invitaciones(cuentas):
    salida = importar("--aplicar", "--excluir-usuario", "Pruebas@Example.com")
    assert "excluidas por usuario — meeting: 1" in salida
    assert "excluidas por usuario — invitee: 2" in salida
    assert Meeting.objects.count() == 3
    assert not MeetingInvitee.objects.filter(user=cuentas[PRUEBAS]).exists()


def test_la_verificacion_detecta_un_invitado_perdido(cuentas, monkeypatch):
    from apps.reuniones.nexo import importador

    original = importador.ImportadorNexoReuniones._crear

    def perder(self):
        original(self)
        MeetingInvitee.objects.filter(user=cuentas[NINO]).delete()

    monkeypatch.setattr(importador.ImportadorNexoReuniones, "_crear", perder)
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar")
    assert not Meeting.objects.exists()


def test_el_informe_csv(cuentas, tmp_path):
    informe = tmp_path.parent / f"{tmp_path.name}-reuniones.csv"
    importar("--aplicar", "--informe", str(informe))
    texto = informe.read_text(encoding="utf-8-sig")
    assert "enlace_descartado" in texto and "enlaces_simulados" in texto


def test_el_informe_csv_no_puede_quedar_en_el_repositorio(cuentas, settings):
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar("--informe", str(settings.BASE_DIR / "informe.csv"))


def test_sin_base_de_nexo_configurada():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoReunionesSQL(alias="nexo_que_no_existe")


def test_reconoce_el_enlace_simulado():
    assert es_enlace_simulado({"zoom_meeting_id": "123", "zoom_join_url": "https://zoom.us/j/123"})
    assert not es_enlace_simulado({"zoom_meeting_id": "123", "zoom_join_url": ZOOM_REAL})
    assert not es_enlace_simulado({"zoom_meeting_id": None, "zoom_join_url": None})


def test_conversion_de_filas_del_driver():
    fila = convertir(
        TABLAS["meeting"],
        {"created_at": "2026-08-01 15:00:00", "updated_at": None, "meeting_date": None},
    )
    assert fila["created_at"] == t(8, 1)
