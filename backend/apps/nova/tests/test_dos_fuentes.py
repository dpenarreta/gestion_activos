"""Dos fuentes en el modo General (13/11/2026, decisión del usuario): si los
documentos responden, Nova responde solo con ellos y los cita; si no, con el
conocimiento general de la IA y un aviso visible. Proveedor siempre falso."""

import pytest

from apps.nova import ajustes, chat

from .test_chat import _documento, _pedir

pytestmark = pytest.mark.django_db

VACACIONES = "Las vacaciones anuales son de quince días hábiles."
PREGUNTA = "¿Cuántos días de vacaciones tengo?"


def test_con_la_respuesta_en_los_documentos_no_hay_aviso(ana, proveedor_falso):
    documento = _documento("Reglamento interno", VACACIONES)
    proveedor_falso.respuesta = "Son quince días hábiles [Reglamento interno, pág. 1]."
    datos = _pedir(ana, modo="general", mensaje=PREGUNTA).json()
    assert datos["con_ia"] is True
    assert datos["origen"] == "documentos"
    assert datos["aviso_origen"] is None
    assert datos["respuesta"] == "Son quince días hábiles [Reglamento interno, pág. 1]."
    assert datos["fuentes"] == [
        {"documento_id": documento.pk, "titulo": "Reglamento interno", "pagina": 1, "citada": True}
    ]


def test_sin_documentos_responde_claude_con_aviso(ana, proveedor_falso):
    proveedor_falso.respuesta = f"{chat.MARCA_GENERAL} París es la capital de Francia."
    datos = _pedir(ana, modo="general", mensaje="¿Cuál es la capital de Francia?").json()
    assert datos["con_ia"] is True
    assert datos["origen"] == "general"
    assert datos["respuesta"] == "París es la capital de Francia."
    assert chat.MARCA_GENERAL not in datos["respuesta"]
    assert "no está en los documentos de la empresa" in datos["aviso_origen"]
    assert datos["fuentes"] == []
    # Sí se llamó a la IA (sin fragmentos, ya no se corta).
    assert len(proveedor_falso.pedidos) == 1


def test_documentos_que_no_responden_pasan_a_general(ana, proveedor_falso):
    _documento("Reglamento interno", VACACIONES)
    proveedor_falso.respuesta = f"{chat.MARCA_GENERAL}: Las horas extra se pagan con recargo."
    datos = _pedir(ana, modo="general", mensaje="¿Cómo se pagan las vacaciones extra?").json()
    assert datos["origen"] == "general"
    assert datos["respuesta"] == "Las horas extra se pagan con recargo."


def test_respuesta_en_parte_de_los_documentos_es_mixta(ana, proveedor_falso):
    _documento("Reglamento interno", VACACIONES)
    proveedor_falso.respuesta = (
        f"{chat.MARCA_GENERAL} Son quince días [Reglamento interno, pág. 1]. Suele convenir "
        "pedirlas con anticipación."
    )
    datos = _pedir(ana, modo="general", mensaje=PREGUNTA).json()
    assert datos["origen"] == "mixto"
    assert datos["respuesta"].startswith("Son quince días")
    assert datos["fuentes"][0]["citada"] is True
    assert "Parte de esta respuesta" in datos["aviso_origen"]


def test_sin_marca_ni_citas_se_avisa_por_las_dudas(ana, proveedor_falso):
    _documento("Reglamento interno", VACACIONES)
    proveedor_falso.respuesta = "Son quince días."
    datos = _pedir(ana, modo="general", mensaje=PREGUNTA).json()
    assert datos["origen"] == "general"
    assert datos["aviso_origen"]


def test_con_solo_fuentes_activado_no_hay_conocimiento_general(ana, admin_gh, proveedor_falso):
    ajustes.cambiar_solo_fuentes(True, admin_gh)
    datos = _pedir(ana, modo="general", mensaje="¿Cuál es la capital de Francia?").json()
    assert datos["con_ia"] is False and datos["motivo"] == "sin_fuentes"
    assert proveedor_falso.pedidos == []


def test_mis_tareas_no_lleva_origen(ana, proveedor_falso):
    proveedor_falso.respuesta = "Priorice lo vencido."
    datos = _pedir(ana, modo="tareas", mensaje="¿Qué priorizo?").json()
    assert datos["con_ia"] is True
    assert datos["origen"] is None and datos["aviso_origen"] is None


@pytest.mark.parametrize(
    ("texto", "citada", "esperado"),
    [
        ("[RESPUESTA GENERAL] Hola.", False, ("Hola.", "general")),
        ("  [respuesta general] — Hola.", False, ("Hola.", "general")),
        ("[RESPUESTA GENERAL] Hola [Doc, pág. 1].", True, ("Hola [Doc, pág. 1].", "mixto")),
        ("Hola [Doc, pág. 1].", True, ("Hola [Doc, pág. 1].", "documentos")),
        ("Hola.", False, ("Hola.", "general")),
    ],
)
def test_separar_origen(texto, citada, esperado):
    assert chat.separar_origen(texto, citada) == esperado
