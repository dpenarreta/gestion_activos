"""`manage.py importar_nexo_ideas`: la Mejora continua de Nexo (ideas, votos e
historial), con los adjuntos base64 convertidos en archivos.

Sin base de Nexo: el comando recibe un lector en memoria con los mismos métodos
que `LectorNexoIdeasSQL`. Los ids de Nexo son altos a propósito, para que un id
copiado sin traducir se note. Los correos son ficticios.
"""

import base64
import copy
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import CommandError, call_command

from apps.empresas.contexto import empresa_actual
from apps.mejora_continua import services
from apps.mejora_continua.models import IdeaVote, ImprovementIdea
from apps.mejora_continua.nexo.lector import TABLAS, LectorNexoIdeasSQL, convertir
from apps.novedades.nexo.comun import ErrorDeNexo
from apps.tasks.roles import ADMIN_GH
from apps.users.models import User

from .conftest import PDF_BYTES, client_for, make_user

pytestmark = pytest.mark.django_db

JEFA, ANA, NINO, PRUEBAS = 9020, 9021, 9022, 9050
USUARIOS_NEXO = [
    {"id": JEFA, "username": "jefa", "email": "Jefa.Nacional@Example.com"},
    {"id": ANA, "username": "ana", "email": "ana.nunez@example.com"},
    {"id": NINO, "username": "nino", "email": "nino.noboa@example.com"},
    {"id": PRUEBAS, "username": "pruebas", "email": "pruebas@example.com"},
]

PDF_DATA_URL = "data:application/pdf;base64," + base64.b64encode(PDF_BYTES).decode()
#: Un ejecutable con nombre de PDF: el adjunto se rechaza, la idea entra.
EXE_B64 = base64.b64encode(b"MZ\x90\x00 ejecutable").decode()


def t(mes, dia, hora=15):
    return datetime(2026, mes, dia, hora, tzinfo=UTC)


def _idea(pk, autor, status, *, nombre=None, mime=None, **extra):
    return {
        "id": pk,
        "created_at": t(8, 1),
        "updated_at": t(8, 20),
        "title": f"Idea {pk} — Señalética y pausas activas",
        "description": "Reducir el ausentismo en la bodega de Durán",
        "impact": "ALTO",
        "status": status,
        "progress": 0,
        "author_id": autor,
        "attachment_name": nombre,
        "attachment_mime": mime,
        **extra,
    }


def _paso(pk, idea, de, a, por=JEFA, comentario=None, dia=10):
    return {
        "id": pk,
        "created_at": t(8, dia),
        "updated_at": t(8, dia),
        "idea_id": idea,
        "from_status": de,
        "to_status": a,
        "changed_by_id": por,
        "comment": comentario,
    }


def _voto(pk, idea, usuario):
    return {
        "id": pk,
        "created_at": t(8, 5),
        "updated_at": t(8, 5),
        "idea_id": idea,
        "user_id": usuario,
    }


def datos_nexo() -> dict[str, list[dict]]:
    etapas = ["PROPUESTA", "EN_REVISION", "APROBADA", "EN_DESARROLLO", "EN_PRUEBAS", "IMPLEMENTADA"]
    return {
        "idea": [
            _idea(7001, ANA, "PROPUESTA", nombre="Propuesta Año.pdf", mime="application/pdf"),
            _idea(7002, NINO, "IMPLEMENTADA", progress=100),
            _idea(7003, ANA, "RECHAZADA"),
            _idea(7004, PRUEBAS, "PROPUESTA", nombre="macro.pdf", mime="application/pdf"),
        ],
        "vote": [
            _voto(7101, 7001, JEFA),
            _voto(7102, 7001, NINO),
            _voto(7103, 7002, ANA),
            _voto(7104, 7002, PRUEBAS),
        ],
        "history": [
            *(
                _paso(7200 + i, 7002, de, a, dia=10 + i)
                for i, (de, a) in enumerate(zip(etapas, etapas[1:], strict=False))
            ),
            _paso(7300, 7003, "PROPUESTA", "RECHAZADA", comentario="Ya existe un buzón digital"),
        ],
    }


ADJUNTOS = {7001: PDF_DATA_URL, 7004: EXE_B64}


class LectorEnMemoria:
    def __init__(self, datos=None, adjuntos=None, innovadores=(NINO, ANA)):
        self.datos = datos if datos is not None else datos_nexo()
        self.adjuntos = dict(ADJUNTOS if adjuntos is None else adjuntos)
        self._innovadores = list(innovadores)
        self.truncar: set[int] = set()

    def filas(self, tabla):
        return copy.deepcopy(sorted(self.datos[tabla], key=lambda f: f["id"]))

    def usuarios(self, ids):
        ids = set(ids)
        return [dict(u) for u in USUARIOS_NEXO if u["id"] in ids]

    def conteos(self):
        return {tabla: len(filas) for tabla, filas in self.datos.items()}

    def adjunto(self, id_nexo):
        if not any(f["id"] == id_nexo for f in self.datos["idea"]):
            return None
        texto = self.adjuntos.get(id_nexo)
        caracteres = len(texto or "") + (5 if id_nexo in self.truncar else 0)
        return {"attachment_data": texto, "caracteres": caracteres}

    def innovadores(self):
        return list(self._innovadores)


@pytest.fixture
def cuentas():
    """Las cuentas de la intranet (mismo correo que en Nexo, con otra
    capitalización a propósito)."""
    return {
        JEFA: User.objects.create_user(username="jnacional", email="jefa.nacional@example.com"),
        ANA: User.objects.create_user(username="anunez", email="ana.nunez@example.com"),
        NINO: User.objects.create_user(username="nnoboa", email="nino.noboa@example.com"),
        PRUEBAS: User.objects.create_user(username="pruebas", email="pruebas@example.com"),
    }


def importar(*args, lector=None):
    salida = StringIO()
    call_command(
        "importar_nexo_ideas",
        "--empresa",
        str(empresa_actual().pk),
        *args,
        lector=lector or LectorEnMemoria(),
        stdout=salida,
    )
    return salida.getvalue()


def _archivos(settings) -> list[Path]:
    return [p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()]


def test_simulacro_no_deja_nada(cuentas, settings):
    salida = importar()
    assert "SIMULACRO" in salida and "todo cuadra" in salida
    assert not ImprovementIdea.objects.exists()
    assert not IdeaVote.objects.todas().exists()
    # Ni el archivo que llegó a escribir.
    assert _archivos(settings) == []


def test_aplicar_copia_ideas_votos_historial_y_adjunto(cuentas, settings):
    salida = importar("--aplicar")
    assert "Importación confirmada." in salida

    assert ImprovementIdea.objects.count() == 4
    con_pdf = ImprovementIdea.objects.get(title__startswith="Idea 7001")
    assert con_pdf.empresa == empresa_actual()
    assert con_pdf.author == cuentas[ANA]
    assert con_pdf.created_at == t(8, 1) and con_pdf.updated_at == t(8, 20)
    assert con_pdf.attachment_name == "Propuesta Año.pdf"
    assert con_pdf.attachment_mime == "application/pdf"
    assert con_pdf.attachment_size == len(PDF_BYTES)
    with con_pdf.attachment.open("rb") as archivo:
        assert archivo.read() == PDF_BYTES
    assert len(_archivos(settings)) == 1

    implementada = ImprovementIdea.objects.get(title__startswith="Idea 7002")
    assert implementada.status == "IMPLEMENTADA" and implementada.progress == 100
    assert not implementada.attachment
    pasos = list(implementada.history.order_by("created_at"))
    assert [p.to_status for p in pasos][-1] == "IMPLEMENTADA"
    assert all(p.changed_by == cuentas[JEFA] for p in pasos)
    assert pasos[0].created_at == t(8, 10)

    rechazada = ImprovementIdea.objects.get(title__startswith="Idea 7003")
    assert rechazada.history.get().comment == "Ya existe un buzón digital"

    votos = {(v.idea_id, v.user_id) for v in IdeaVote.objects.all()}
    assert votos == {
        (con_pdf.pk, cuentas[JEFA].pk),
        (con_pdf.pk, cuentas[NINO].pk),
        (implementada.pk, cuentas[ANA].pk),
        (implementada.pk, cuentas[PRUEBAS].pk),
    }


def test_el_adjunto_invalido_no_se_importa_pero_la_idea_si(cuentas, tmp_path):
    informe = tmp_path.parent / f"{tmp_path.name}-informe.csv"
    salida = importar("--aplicar", "--informe", str(informe))
    assert "Adjunto no importado — idea #7004 «macro.pdf»" in salida
    assert "1 adjuntos no se importaron" in salida
    idea = ImprovementIdea.objects.get(title__startswith="Idea 7004")
    assert not idea.attachment and idea.attachment_name == ""
    texto = informe.read_text(encoding="utf-8-sig")
    assert "adjunto_rechazado" in texto and "macro.pdf" in texto


def test_la_insignia_se_deriva_y_se_compara_con_la_de_nexo(cuentas):
    salida = importar("--aplicar")
    assert services.innovadores([c.pk for c in cuentas.values()]) == {cuentas[NINO].pk}
    # Ana tenía la insignia en Nexo pero ninguna idea suya está implementada.
    assert f"La cuenta #{cuentas[ANA].pk} tenía la insignia «innovador» en Nexo" in salida


def test_un_importado_se_lee_por_la_api(cuentas):
    importar("--aplicar")
    admin = make_user("admingh", ADMIN_GH)
    cliente = client_for(admin)
    idea = ImprovementIdea.objects.get(title__startswith="Idea 7001")
    detalle = cliente.get(f"/api/v1/mejora-continua/ideas/{idea.pk}/").json()
    assert detalle["vote_count"] == 2
    assert detalle["attachment"]["viewer"] == "pdf"
    archivo = cliente.get(
        detalle["attachment"]["url"].replace("/mejora-continua", "/api/v1/mejora-continua")
    )
    assert archivo.status_code == 200
    assert b"".join(archivo.streaming_content) == PDF_BYTES
    tablero = cliente.get("/api/v1/mejora-continua/ideas/").json()
    autor = next(i["author"] for i in tablero if i["status"] == "IMPLEMENTADA")
    assert autor["id"] == cuentas[NINO].pk and autor["innovador"] is True


def test_aborta_si_falta_un_usuario(cuentas):
    cuentas[PRUEBAS].delete()
    with pytest.raises(CommandError, match="Faltan 1 usuarios") as error:
        importar("--aplicar")
    assert "pruebas@example.com" in str(error.value)
    assert not ImprovementIdea.objects.exists()


def test_no_importa_dos_veces(cuentas):
    importar("--aplicar")
    with pytest.raises(CommandError, match="ya tiene ideas"):
        importar("--aplicar")
    assert ImprovementIdea.objects.count() == 4


def test_excluir_usuario_quita_sus_ideas_y_sus_votos(cuentas):
    salida = importar("--aplicar", "--excluir-usuario", "Pruebas@Example.com")
    assert "excluidas por usuario — idea: 1" in salida
    assert "excluidas por usuario — vote: 1" in salida
    assert ImprovementIdea.objects.count() == 3
    assert not IdeaVote.objects.filter(user=cuentas[PRUEBAS]).exists()
    assert not ImprovementIdea.objects.filter(author=cuentas[PRUEBAS]).exists()


def test_excluir_a_quien_movio_ideas_ajenas_aborta(cuentas):
    with pytest.raises(CommandError, match="ideas de otras personas"):
        importar("--aplicar", "--excluir-usuario", "jefa.nacional@example.com")
    assert not ImprovementIdea.objects.exists()


def test_una_lectura_truncada_del_adjunto_no_cuadra(cuentas, settings):
    lector = LectorEnMemoria()
    lector.truncar.add(7001)
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar", lector=lector)
    assert not ImprovementIdea.objects.exists()
    assert _archivos(settings) == []


def test_la_verificacion_detecta_un_voto_perdido(cuentas, settings, monkeypatch):
    from apps.mejora_continua.nexo import importador

    original = importador.ImportadorNexoIdeas._crear

    def perder_un_voto(self):
        original(self)
        IdeaVote.objects.filter(user=cuentas[NINO]).delete()

    monkeypatch.setattr(importador.ImportadorNexoIdeas, "_crear", perder_un_voto)
    with pytest.raises(CommandError, match="NO cuadra"):
        importar("--aplicar")
    assert not ImprovementIdea.objects.exists()
    assert _archivos(settings) == []


def test_sin_base_de_nexo_configurada():
    with pytest.raises(ErrorDeNexo, match="NEXO_DB_NAME"):
        LectorNexoIdeasSQL(alias="nexo_que_no_existe")


def test_el_informe_csv_no_puede_quedar_en_el_repositorio(cuentas, settings):
    with pytest.raises(CommandError, match="dentro del repositorio"):
        importar("--informe", str(settings.BASE_DIR / "informe.csv"))


def test_conversion_de_filas_del_driver():
    fila = convertir(TABLAS["idea"], {"created_at": "2026-08-01 15:00:00", "updated_at": None})
    assert fila["created_at"] == t(8, 1)
