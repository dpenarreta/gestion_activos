"""«Responder solo con las fuentes» (ajuste por empresa, 09/11/2026): sin
fragmentos el modo General no llama a la IA ni cuenta para el límite; con
fragmentos la instrucción del sistema exige responder solo con ellos; los
modos Mis tareas y Mi equipo no se cortan. Desde el 13/11/2026 viene
desactivado (dos fuentes: `test_dos_fuentes.py`), así que estas pruebas lo
activan. Proveedor siempre falso."""

from datetime import UTC, datetime

import pytest

from apps.core.models import AuditLog
from apps.informes.tests.conftest import client_for, congelar, make_user
from apps.nova import ajustes, chat, cliente, nucleo
from apps.nova.models import UsoNova

from .test_chat import _documento, _pedir

pytestmark = pytest.mark.django_db

AHORA = datetime(2026, 10, 20, 15, tzinfo=UTC)
URL_AJUSTES = "/api/v1/nova/conocimiento/ajustes/"


@pytest.fixture(autouse=True)
def _reloj(monkeypatch):
    congelar(monkeypatch, AHORA)


@pytest.fixture
def peticiones(proveedor_falso, monkeypatch):
    """Las `PeticionIA` que habrían salido (sistema y temperatura incluidos),
    sin llamar a nadie."""
    enviadas: list[cliente.PeticionIA] = []

    def generar(peticion, **_opciones):
        enviadas.append(peticion)
        return cliente.RespuestaIA(
            texto=proveedor_falso.respuesta, modelo="falso", proveedor="anthropic"
        )

    monkeypatch.setattr("apps.nova.cliente.generar", generar)
    return enviadas


VACACIONES = "Las vacaciones anuales son de quince días hábiles."


# ── Modo General ────────────────────────────────────────────────────────────


def test_esta_desactivado_por_defecto():
    assert ajustes.solo_fuentes() is False


def test_sin_fragmentos_no_llama_ni_cuenta_para_el_limite(ana, admin_gh, peticiones, settings):
    ajustes.cambiar_solo_fuentes(True, admin_gh)
    settings.NOVA_LIMITE_DIARIO_POR_USUARIO = 1
    _documento("Reglamento interno", VACACIONES)
    for pregunta in ("¿Cuál es la capital de Francia?", "Hola"):
        respuesta = _pedir(ana, modo="general", mensaje=pregunta)
        assert respuesta.status_code == 200, respuesta.content
        datos = respuesta.json()
        assert datos["con_ia"] is False
        assert datos["motivo"] == "sin_fuentes"
        assert datos["mensaje"] == (
            "No encontré esa información en los documentos de la base de conocimiento. "
            "Pruebe con otras palabras o consulte a Gestión Humana."
        )
        assert datos["fuentes"] == []
    assert peticiones == []
    usos = UsoNova.objects.filter(usuario=ana, funcion="chat")
    assert usos.count() == 2
    assert set(usos.values_list("resultado", "llamada")) == {("sin_fuentes", False)}
    assert nucleo.usos_de_hoy(ana) == 0
    # El límite (1) sigue entero: la pregunta con fuentes sí se responde.
    respuesta = _pedir(ana, modo="general", mensaje="¿Cuántos días de vacaciones tengo?")
    assert respuesta.json()["con_ia"] is True
    assert len(peticiones) == 1


def test_con_fragmentos_la_instruccion_exige_solo_fuentes(
    ana, admin_gh, peticiones, proveedor_falso
):
    ajustes.cambiar_solo_fuentes(True, admin_gh)
    documento = _documento("Reglamento interno", VACACIONES)
    proveedor_falso.respuesta = "Son quince días hábiles [Reglamento interno, pág. 1]."
    respuesta = _pedir(ana, modo="general", mensaje="¿Cuántos días de vacaciones tengo?")
    assert respuesta.status_code == 200, respuesta.content
    datos = respuesta.json()
    assert datos["con_ia"] is True
    assert datos["fuentes"] == [
        {"documento_id": documento.pk, "titulo": "Reglamento interno", "pagina": 1, "citada": True}
    ]
    (peticion,) = peticiones
    sistema = peticion.sistema
    assert "REGLA DE FUENTES" in sistema
    assert "ÚNICAMENTE con la información de los `documentos`" in sistema
    assert "PROHIBIDO completar" in sistema
    assert "[Título del documento, pág. N]" in sistema
    assert chat.NO_ESTA_EN_LOS_DOCUMENTOS in sistema
    assert "buenas prácticas generales" not in sistema
    assert peticion.temperatura == chat.TEMPERATURA_CON_FUENTES


def test_ajuste_desactivado_usa_las_dos_fuentes(ana, peticiones):
    respuesta = _pedir(ana, modo="general", mensaje="¿Cuál es la capital de Francia?")
    assert respuesta.json()["con_ia"] is True
    (peticion,) = peticiones
    assert "PROHIBIDO completar" not in peticion.sistema
    assert "responde ÚNICAMENTE con ellos" in peticion.sistema
    assert chat.MARCA_GENERAL in peticion.sistema
    assert "[Título del documento, pág. N]" in peticion.sistema
    assert peticion.temperatura == chat.TEMPERATURA_LIBRE


# ── Mis tareas y Mi equipo ──────────────────────────────────────────────────


def test_mis_tareas_no_se_bloquea_por_falta_de_fragmentos(ana, admin_gh, peticiones):
    ajustes.cambiar_solo_fuentes(True, admin_gh)
    respuesta = _pedir(ana, modo="tareas", mensaje="¿Qué priorizo esta semana?")
    assert respuesta.json()["con_ia"] is True
    (peticion,) = peticiones
    assert "REGLA DE FUENTES" in peticion.sistema
    assert "las `tareas` de la persona" in peticion.sistema
    assert "no puedo responder eso" in peticion.sistema
    assert peticion.temperatura == chat.TEMPERATURA_CON_FUENTES


def test_mi_equipo_no_se_bloquea_por_falta_de_fragmentos(
    coordinadora, equipo, admin_gh, peticiones
):
    ajustes.cambiar_solo_fuentes(True, admin_gh)
    respuesta = _pedir(coordinadora, modo="equipo", mensaje="Resumen del equipo")
    assert respuesta.json()["con_ia"] is True
    (peticion,) = peticiones
    assert "REGLA DE FUENTES" in peticion.sistema
    assert "el `equipo` (con sus cifras)" in peticion.sistema


def test_citada_reconoce_el_formato():
    assert chat.citada("Son 15 días [Reglamento Interno, pág. 3].", "Reglamento interno", 3)
    assert chat.citada("(Fuente: Reglamento interno, página 3)", "Reglamento interno", 3)
    assert not chat.citada("[Reglamento interno, pág. 31]", "Reglamento interno", 3)
    assert not chat.citada("Son 15 días.", "Reglamento interno", 3)


# ── El ajuste ───────────────────────────────────────────────────────────────


def test_solo_quien_gestiona_cambia_el_ajuste(ana, admin_gh):
    # Quien solo ve la base lo ve, pero no lo cambia.
    assert client_for(ana).get(URL_AJUSTES).json() == {"solo_fuentes": False, "gestionar": False}
    respuesta = client_for(ana).put(URL_AJUSTES, {"solo_fuentes": True}, format="json")
    assert respuesta.status_code == 403
    assert ajustes.solo_fuentes() is False
    assert not AuditLog.objects.filter(action="nova.configuracion.cambiada").exists()

    respuesta = client_for(admin_gh).put(URL_AJUSTES, {"solo_fuentes": True}, format="json")
    assert respuesta.status_code == 200, respuesta.content
    assert respuesta.json()["solo_fuentes"] is True
    assert ajustes.solo_fuentes() is True
    evento = AuditLog.objects.get(action="nova.configuracion.cambiada")
    assert evento.previous_values == {"solo_fuentes": False}
    assert evento.new_values == {"solo_fuentes": True}
    assert evento.module == "nova"
    # /me/ y la lista de documentos lo reflejan.
    me = client_for(ana).get("/api/v1/nova/me/").json()
    assert me["solo_fuentes"] is True and me["hay_documentos"] is False
    lista = client_for(ana).get("/api/v1/nova/conocimiento/documentos/").json()
    assert lista["solo_fuentes"] is True


def test_el_ajuste_valida_el_valor(admin_gh):
    respuesta = client_for(admin_gh).put(URL_AJUSTES, {"solo_fuentes": "no"}, format="json")
    assert respuesta.status_code == 400
    assert "solo_fuentes" in respuesta.json()["error"]["details"]


def test_sin_permiso_no_ve_el_ajuste():
    nadie = make_user("sinrol")
    assert client_for(nadie).get(URL_AJUSTES).status_code == 403


def test_me_dice_si_hay_documentos(ana):
    assert client_for(ana).get("/api/v1/nova/me/").json()["hay_documentos"] is False
    _documento("Reglamento interno", VACACIONES)
    me = client_for(ana).get("/api/v1/nova/me/").json()
    assert me["hay_documentos"] is True and me["solo_fuentes"] is False
