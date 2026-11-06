"""`manage.py importar_nexo_escritorio`: las notas (con respuestas y
adjuntos), los recordatorios y la bitácora del Escritorio Digital de Nexo.

Sin base de Nexo: el comando recibe un lector en memoria con los mismos métodos
que `LectorNexoEscritorioSQL`. Los ids de Nexo son altos a propósito, para que
un id copiado sin traducir se note. Los correos son ficticios.
"""

import base64
import copy
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.escritorio.models import DeskAuditLog, DeskNote, DeskNoteReply, PersonalReminder
from apps.escritorio.nexo.lector import TABLAS, LectorNexoEscritorioSQL, convertir
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.tasks.models import Task
from apps.users.models import User

from .conftest import PDF_BYTES, client_for

pytestmark = pytest.mark.django_db

JEFA, ANA, NINO, PRUEBAS = 9020, 9021, 9022, 9050
USUARIOS_NEXO = [
    {"id": JEFA, "username": "jefa", "email": "Jefa.Nacional@Example.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@example.com"},
    {"id": NINO, "username": "nino", "email": "nino.noboa@example.com"},
    {"id": PRUEBAS, "username": "pruebas", "email": "pruebas@example.com"},
]
TAREA_NEXO = 7700

PDF_DATA_URL = "data:application/pdf;base64," + base64.b64encode(PDF_BYTES).decode()
EXE_B64 = base64.b64encode(b"MZ\x90\x00 ejecutable").decode()


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _recordatorio(pk, dueno, **extra):
    return {
        "id": pk,
        "created_at": t(8, 1),
        "updated_at": t(8, 2),
        "user_id": dueno,
        "title": f"Recordatorio {pk} — Llamar a Begoña",
        "description": "Por el certificado de Peñaherrera",
        "due_at": t(9, 1),
        "priority": "MEDIA",
        "status": "PENDIENTE",
        "repeat": "UNA_VEZ",
        "completed_at": None,
        "archived": False,
        "archived_at": None,
        "notified": True,
        "converted_to_task_id": None,
        "converted_to_task_at": None,
        "attachment_name": None,
        "attachment_mime": None,
        **extra,
    }


def _nota(pk, de, para, **extra):
    return {
        "id": pk,
        "created_at": t(8, 3),
        "updated_at": t(8, 4),
        "sender_id": de,
        "recipient_id": para,
        "message": f"Nota {pk}: revisar el acta de Durán",
        "priority": "IMPORTANTE",
        "color": "VERDE",
        "read": True,
        "read_at": t(8, 4),
        "pinned": False,
        "archived": False,
        "archived_at": None,
        "attachment_name": None,
        "attachment_mime": None,
        "converted_to_reminder_id": None,
        "converted_at": None,
        "deleted_at": None,
        **extra,
    }


def _respuesta(pk, nota, autor, mensaje):
    return {
        "id": pk,
        "created_at": t(8, 5),
        "updated_at": t(8, 5),
        "note_id": nota,
        "author_id": autor,
        "message": mensaje,
    }


def _evento(pk, tipo, entidad, usuario, accion, metadata=None):
    return {
        "id": pk,
        "created_at": t(8, 6),
        "entity_type": tipo,
        "entity_id": entidad,
        "user_id": usuario,
        "action": accion,
        "metadata": metadata,
    }


def datos_nexo():
    return {
        "reminder": [
            _recordatorio(
                6001,
                NINO,
                attachment_name="acta.pdf",
                attachment_mime="application/pdf",
                converted_to_task_id=TAREA_NEXO,
                converted_to_task_at=t(8, 9),
            ),
            _recordatorio(6002, ANA, status="COMPLETADO", completed_at=t(9, 1), notified=False),
            _recordatorio(6003, PRUEBAS),
        ],
        "note": [
            _nota(
                6101,
                ANA,
                NINO,
                attachment_name="acta.pdf",
                attachment_mime="application/pdf",
                converted_to_reminder_id=6001,
                converted_at=t(8, 8),
                pinned=True,
            ),
            _nota(6102, NINO, ANA, read=False, read_at=None, archived=True, archived_at=t(8, 7)),
            # En la papelera de su remitente: no se importa.
            _nota(6103, ANA, JEFA, deleted_at=t(8, 9)),
            # Adjunto inválido: la nota entra sin él.
            _nota(6104, JEFA, ANA, attachment_name="macro.pdf", attachment_mime="application/pdf"),
            _nota(6105, PRUEBAS, ANA),
        ],
        "reply": [
            _respuesta(6201, 6101, NINO, "Gracias, Ana"),
            _respuesta(6202, 6101, ANA, "De nada, Niño"),
            _respuesta(6203, 6103, JEFA, "En la papelera"),
        ],
        "log": [
            _evento(6301, "NOTE", 6101, ANA, "CREATED"),
            _evento(6302, "NOTE", 6101, NINO, "CONVERTED_TO_REMINDER", {"reminderId": 6001}),
            _evento(6303, "REMINDER", 6001, NINO, "CREATED", {"convertedFromNoteId": 6101}),
            _evento(6304, "REMINDER", 6001, NINO, "CONVERTED_TO_TASK", {"taskId": TAREA_NEXO}),
            _evento(6305, "NOTE", 6103, ANA, "DELETED", {"origin": "manual"}),
            # De una nota que ya no existe en Nexo.
            _evento(6306, "NOTE", 5999, ANA, "CREATED"),
            _evento(6307, "REMINDER", 6003, PRUEBAS, "CREATED"),
        ],
    }


ADJUNTOS = {("note", 6101): PDF_DATA_URL, ("reminder", 6001): PDF_DATA_URL, ("note", 6104): EXE_B64}


class LectorEnMemoria:
    def __init__(self, datos=None):
        self.datos = datos if datos is not None else datos_nexo()
        self.adjuntos = dict(ADJUNTOS)
        self.truncar: set[tuple[str, int]] = set()

    def filas(self, tabla):
        return copy.deepcopy(sorted(self.datos[tabla], key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in USUARIOS_NEXO if u["id"] in ids]

    def conteos(self):
        return {tabla: len(filas) for tabla, filas in self.datos.items()}

    def adjunto(self, tabla, id_nexo):
        if not any(f["id"] == id_nexo for f in self.datos[tabla]):
            return None
        texto = self.adjuntos.get((tabla, id_nexo))
        extra = 5 if (tabla, id_nexo) in self.truncar else 0
        return {"attachment_data": texto, "caracteres": len(texto or "") + extra}

    def tareas(self, ids):
        tarea = {
            "id": TAREA_NEXO,
            "title": "Llamar a Begoña",
            "created_at": t(8, 9),
            "assigned_to_id": NINO,
            "created_by_id": NINO,
        }
        return [dict(tarea)] if TAREA_NEXO in set(ids) else []


@pytest.fixture
def cuentas():
    return {
        JEFA: User.objects.create_user(username="jnacional", email="jefa.nacional@example.com"),
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
        NINO: User.objects.create_user(username="nnoboa", email="nino.noboa@example.com"),
        PRUEBAS: User.objects.create_user(username="pruebas", email="pruebas@example.com"),
    }


@pytest.fixture
def tarea_importada(cuentas):
    """La tarea que ya trajo `importar_nexo_tareas` (misma clave natural)."""
    from apps.novedades.nexo.comun import fechas_tal_cual

    with fechas_tal_cual([Task]):
        return Task.objects.create(
            title="Llamar a Begoña",
            priority="MEDIA",
            frequency="PUNTUAL",
            start_date=t(8, 9),
            end_date=t(8, 10),
            estimated_hours=1,
            assigned_to=cuentas[NINO],
            created_by=cuentas[NINO],
            created_at=t(8, 9),
            updated_at=t(8, 9),
        )


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_escritorio",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def _archivos(settings) -> list[Path]:
    return [p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()]


def test_simulacro_no_deja_nada(cuentas, tarea_importada, settings):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert not DeskNote.objects.exists() and not PersonalReminder.objects.exists()
    assert not DeskAuditLog.objects.exists()
    assert _archivos(settings) == []


def test_aplicar_copia_todo(cuentas, tarea_importada, settings):
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida
    assert DeskNote.objects.count() == 4
    assert PersonalReminder.objects.count() == 3
    assert DeskNoteReply.objects.count() == 2
    assert DeskAuditLog.objects.count() == 5

    nota = DeskNote.objects.get(message__startswith="Nota 6101")
    assert nota.sender == cuentas[ANA] and nota.recipient == cuentas[NINO]
    assert nota.created_at == t(8, 3) and nota.read_at == t(8, 4) and nota.pinned
    assert nota.attachment_name == "acta.pdf" and nota.attachment_size == len(PDF_BYTES)
    recordatorio = PersonalReminder.objects.get(title__startswith="Recordatorio 6001")
    assert nota.converted_to_reminder_id == recordatorio.pk
    assert recordatorio.converted_to_task_id == tarea_importada.pk
    assert recordatorio.notified is True and recordatorio.due_at == t(9, 1)
    with recordatorio.attachment.open("rb") as archivo:
        assert archivo.read() == PDF_BYTES
    assert len(_archivos(settings)) == 2

    sin_adjunto = DeskNote.objects.get(message__startswith="Nota 6104")
    assert not sin_adjunto.attachment
    assert "Adjunto no importado — note #6104 «macro.pdf»" in salida
    assert not DeskNote.objects.filter(message__startswith="Nota 6103").exists()
    assert "omitidas — note (papelera): 1" in salida

    # Los ids de la bitácora, traducidos.
    convertida = DeskAuditLog.objects.get(action="CONVERTED_TO_REMINDER")
    assert convertida.entity_id == nota.pk
    assert convertida.metadata == {"reminderId": recordatorio.pk}
    assert DeskAuditLog.objects.get(action="CONVERTED_TO_TASK").metadata == {
        "taskId": tarea_importada.pk
    }


def test_un_importado_se_lee_por_la_api(cuentas, tarea_importada):
    from django.contrib.auth.models import Group

    importar("--aplicar")
    cuentas[NINO].groups.set([Group.objects.get(name="ASISTENTE_GH")])
    cliente = client_for(cuentas[NINO])
    notas = cliente.get("/api/v1/escritorio/notes/").json()
    assert [n["message"][:9] for n in notas] == ["Nota 6101"]
    assert notas[0]["reply_count"] == 2 and notas[0]["attachment"]["viewer"] == "pdf"
    archivo = cliente.get(
        notas[0]["attachment"]["url"].replace("/escritorio", "/api/v1/escritorio")
    )
    assert b"".join(archivo.streaming_content) == PDF_BYTES
    historial = cliente.get(f"/api/v1/escritorio/notes/{notas[0]['id']}/history/").json()
    assert [e["action"] for e in historial] == ["CREATED", "CONVERTED_TO_REMINDER"]


def test_sin_la_tarea_importada_queda_el_aviso(cuentas):
    salida = importar("--aplicar")
    assert "no encuentran su tarea" in salida
    recordatorio = PersonalReminder.objects.get(title__startswith="Recordatorio 6001")
    assert recordatorio.converted_to_task_id is None and recordatorio.converted_to_task_at
    assert DeskAuditLog.objects.get(action="CONVERTED_TO_TASK").metadata == {"taskId": None}


def test_aborta_si_falta_un_usuario(cuentas):
    cuentas[PRUEBAS].delete()
    with pytest.raises(CommandError, match="Faltan 1 usuarios"):
        importar("--aplicar")
    assert not DeskNote.objects.exists()


def test_no_importa_dos_veces(cuentas, tarea_importada):
    importar("--aplicar")
    with pytest.raises(CommandError, match="ya tiene datos del Escritorio"):
        importar("--aplicar")
    assert DeskNote.objects.count() == 4


def test_excluir_usuario(cuentas, tarea_importada):
    salida = importar("--aplicar", "--excluir-usuario", "pruebas@example.com")
    assert "excluidas por usuario — reminder: 1" in salida
    assert "excluidas por usuario — note: 1" in salida
    assert not DeskNote.objects.filter(sender=cuentas[PRUEBAS]).exists()
    assert not PersonalReminder.objects.filter(user=cuentas[PRUEBAS]).exists()
    assert not DeskAuditLog.objects.filter(user=cuentas[PRUEBAS]).exists()


def test_una_lectura_truncada_no_cuadra(cuentas, tarea_importada, settings):
    lector = LectorEnMemoria()
    lector.truncar.add(("reminder", 6001))
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar", lector=lector)
    assert not DeskNote.objects.exists() and _archivos(settings) == []


def test_la_verificacion_detecta_una_respuesta_perdida(cuentas, tarea_importada, monkeypatch):
    from apps.escritorio.nexo import importador

    original = importador.ImportadorNexoEscritorio._crear

    def perder(self):
        original(self)
        DeskNoteReply.objects.filter(author=cuentas[ANA]).delete()

    monkeypatch.setattr(importador.ImportadorNexoEscritorio, "_crear", perder)
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar")
    assert not DeskNote.objects.exists()


def test_el_informe_csv_no_puede_quedar_en_el_repositorio(cuentas, settings):
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar("--informe", str(settings.BASE_DIR / "informe.csv"))


def test_sin_base_de_nexo_configurada():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoEscritorioSQL(alias="nexo_que_no_existe")


def test_conversion_de_filas_del_driver():
    fila = convertir(
        TABLAS["log"], {"created_at": "2026-08-01 15:00:00", "metadata": '{"reminderId": 3}'}
    )
    assert fila["created_at"] == t(8, 1) and fila["metadata"] == {"reminderId": 3}
