"""El núcleo: cuándo no llama, qué sale hacia el proveedor (seudónimos, sin
salud), el registro de uso (solo metadatos) y el límite diario."""

import pytest

from apps.informes.tests.conftest import make_user
from apps.nova import nucleo
from apps.nova.models import UsoNova
from apps.nova.seudonimos import Seudonimizador

pytestmark = pytest.mark.django_db


@pytest.fixture
def persona():
    return make_user("pnova", "ANALISTA_CC", first_name="Ana", last_name="Núñez")


def _pedido(datos, **extra):
    return nucleo.Pedido(sistema="Responda en JSON.", datos=datos, **extra)


def test_sin_clave_no_llama_y_lo_registra(persona):
    resultado = nucleo.generar(persona, "prueba", _pedido({"x": 1}))
    assert not resultado.con_ia and resultado.motivo == "sin_clave"
    assert "sin IA" in resultado.mensaje
    uso = UsoNova.objects.get()
    assert (uso.resultado, uso.llamada, uso.exito) == ("sin_clave", False, False)


def test_con_ia_seudonimiza_repone_y_registra_solo_metadatos(persona, proveedor_falso):
    proveedor_falso.respuesta = {"texto": "Persona A cumplió el 80%."}
    seud = Seudonimizador()
    alias = seud.persona("Ana Núñez", persona.username, clave=persona.pk)
    resultado = nucleo.generar(
        persona,
        "prueba",
        _pedido(
            {
                "persona": alias,
                "cumplimiento": 80,
                "comentario": "Ana Núñez (anunez@example.com, 0991234567) pidió revisión",
                "estado_especial": "Licencia de maternidad",
                "ausencia": "Permiso médico",
            }
        ),
        seud,
    )
    assert resultado.con_ia
    assert resultado.datos == {"texto": "Ana Núñez cumplió el 80%."}

    enviado = proveedor_falso.enviado()
    for prohibido in ("Ana", "Núñez", "anunez", "@", "0991234567", "aternidad", "édico"):
        assert prohibido not in enviado
    assert "Persona A" in enviado and "80" in enviado

    uso = UsoNova.objects.get()
    assert uso.resultado == "con_ia" and uso.exito and uso.llamada
    assert (uso.proveedor, uso.modelo) == ("anthropic", "claude-opus-5-5")
    assert (uso.tokens_entrada, uso.tokens_salida) == (120, 45)
    # Solo metadatos: ningún campo guarda el pedido ni la respuesta.
    campos = {f.name for f in UsoNova._meta.get_fields()}
    assert not campos & {"texto", "contenido", "pedido", "respuesta", "prompt"}


def test_lo_que_se_colo_en_texto_libre_se_limpia_antes_de_salir(persona, proveedor_falso):
    """Un nombre conocido en un título de tarea sale con su seudónimo; la
    verificación final ve el texto exacto que se envía."""
    proveedor_falso.respuesta = {"ok": True}
    seud = Seudonimizador()
    seud.persona("Ana Núñez", clave=persona.pk)
    nucleo.generar(persona, "prueba", _pedido({"titulo": "Conciliar con Núñez"}), seud)
    assert "Núñez" not in proveedor_falso.enviado()
    assert "Conciliar con Persona A" in proveedor_falso.enviado()


def test_historial_del_chat_tambien_se_sanea(persona, proveedor_falso):
    proveedor_falso.respuesta = "Respuesta"
    seud = Seudonimizador()
    seud.persona("Ana Núñez", clave=persona.pk)
    resultado = nucleo.generar(
        persona,
        "chat",
        _pedido(
            "¿Cómo va Ana?",
            respuesta_json=False,
            historial=[{"rol": "usuario", "texto": "Ana está con reposo médico"}],
        ),
        seud,
    )
    assert resultado.con_ia and resultado.texto == "Respuesta"
    (pedido,) = proveedor_falso.pedidos
    assert [m["role"] for m in pedido["messages"]] == ["user", "user"]
    assert "Ana" not in proveedor_falso.enviado() and "reposo" not in proveedor_falso.enviado()
    assert "format" not in pedido["output_config"]


def test_bloquea_si_falta_seudonimizar(persona, proveedor_falso, monkeypatch):
    """Si algo prohibido sobrevive a la limpieza, no se envía nada."""
    seud = Seudonimizador()
    seud.persona("Ana Núñez", clave=persona.pk)
    monkeypatch.setattr(seud, "sanear", lambda datos: datos)
    resultado = nucleo.generar(persona, "prueba", _pedido({"n": "Ana Núñez"}), seud)
    assert not resultado.con_ia and resultado.motivo == "bloqueado"
    assert proveedor_falso.pedidos == []
    assert UsoNova.objects.get().resultado == "bloqueado"


def test_sin_consentimiento_no_llama(persona, proveedor_falso, monkeypatch):
    monkeypatch.setattr("apps.nova.nucleo.acepto_aviso_vigente", lambda _u: False)
    resultado = nucleo.generar(persona, "prueba", _pedido({"x": 1}))
    assert resultado.motivo == "sin_consentimiento" and proveedor_falso.pedidos == []


def test_limite_diario(persona, proveedor_falso, settings):
    settings.NOVA_LIMITE_DIARIO_POR_USUARIO = 2
    proveedor_falso.respuesta = {"x": 1}
    assert nucleo.generar(persona, "prueba", _pedido({"x": 1})).con_ia
    assert nucleo.generar(persona, "prueba", _pedido({"x": 1})).con_ia
    tercero = nucleo.generar(persona, "prueba", _pedido({"x": 1}))
    assert not tercero.con_ia and tercero.motivo == "limite"
    assert "límite de 2 consultas diarias" in tercero.mensaje
    assert len(proveedor_falso.pedidos) == 2
    # Lo que no llamó al proveedor no cuenta.
    assert nucleo.usos_de_hoy(persona) == 2
    estado = nucleo.estado(persona)
    assert estado["disponibles_hoy"] == 0 and estado["motivo"] == "limite"


def test_varios_pedidos_no_superan_el_limite(persona, proveedor_falso, settings):
    settings.NOVA_LIMITE_DIARIO_POR_USUARIO = 3
    resultados = nucleo.generar_varios(persona, "informe", [_pedido({"x": i}) for i in range(4)])
    assert all(r.motivo == "limite" for r in resultados)
    assert proveedor_falso.pedidos == []


def test_falla_del_proveedor_degrada(persona, proveedor_falso):
    proveedor_falso.respuesta = "esto no es JSON"
    resultado = nucleo.generar(persona, "prueba", _pedido({"x": 1}))
    assert not resultado.con_ia and resultado.motivo == "fallo"
    uso = UsoNova.objects.get()
    assert uso.resultado == "fallo" and uso.llamada and not uso.exito


# ── Salud como tema general: solo el modo General del chat ─────────────────

PREGUNTA = "¿Cuántos días de licencia por maternidad da la empresa?"


def _general(**extra):
    return {"modo": "general", "pregunta": PREGUNTA, **extra}


def test_el_chat_general_deja_salir_la_salud_como_tema_general(persona, proveedor_falso):
    proveedor_falso.respuesta = "Doce semanas."
    resultado = nucleo.generar(
        persona,
        "chat",
        _pedido(_general(), respuesta_json=False, permitir_salud_general=True),
    )
    assert resultado.con_ia
    assert "licencia por maternidad" in proveedor_falso.enviado()


@pytest.mark.parametrize(
    ("funcion", "datos"),
    [
        # Las demás funciones de Nova, aunque el texto sea general.
        ("kpi", _general()),
        ("informe", _general()),
        ("inicio", _general()),
        # El chat en los modos con datos de personas.
        ("chat", {**_general(), "modo": "tareas"}),
        ("chat", {**_general(), "modo": "equipo"}),
        # Modo general pero con contexto de personas colado.
        ("chat", _general(tareas={"detalle": []})),
        ("chat", _general(equipo={"personas": []})),
        ("chat", _general(persona_que_pregunta="Persona A")),
        # Datos que no son el contexto del chat.
        ("chat", PREGUNTA),
    ],
)
def test_fuera_del_chat_general_el_indicador_se_ignora(persona, proveedor_falso, funcion, datos):
    proveedor_falso.respuesta = "Respuesta"
    nucleo.generar(
        persona,
        funcion,
        _pedido(datos, respuesta_json=False, permitir_salud_general=True),
    )
    assert "maternidad" not in proveedor_falso.enviado()
    assert not nucleo._salud_permitida(funcion, _pedido(datos, permitir_salud_general=True))


def test_la_verificacion_bloquea_salud_fuera_del_chat_general(
    persona, proveedor_falso, monkeypatch
):
    """Aunque la limpieza fallara, la verificación final sigue bloqueando la
    salud en cualquier otra función."""
    seud = Seudonimizador()
    monkeypatch.setattr(seud, "sanear", lambda datos, **_o: datos)
    for funcion in ("kpi", "informe", "inicio"):
        resultado = nucleo.generar(
            persona, funcion, _pedido(_general(), permitir_salud_general=True), seud
        )
        assert not resultado.con_ia and resultado.motivo == "bloqueado"
    assert proveedor_falso.pedidos == []


def test_en_el_chat_general_la_verificacion_sigue_protegiendo_nombres_y_contacto(
    persona, proveedor_falso, monkeypatch
):
    seud = Seudonimizador()
    seud.persona("Ana Núñez", clave=persona.pk)
    monkeypatch.setattr(seud, "sanear", lambda datos, **_o: datos)
    for colado in ("Ana Núñez", "anunez@example.com", "0912345678"):
        resultado = nucleo.generar(
            persona,
            "chat",
            _pedido(_general(nota=colado), respuesta_json=False, permitir_salud_general=True),
            seud,
        )
        assert not resultado.con_ia and resultado.motivo == "bloqueado", colado
    assert proveedor_falso.pedidos == []


def test_solo_el_chat_activa_el_indicador():
    """Ninguna otra parte del sistema pide `permitir_salud_general` ni
    `permitir_salud`: solo el chat (y el núcleo/seudónimos que lo definen)."""
    from pathlib import Path

    from django.conf import settings

    raiz = Path(settings.BASE_DIR) / "apps"
    usan = {
        str(archivo.relative_to(raiz)).replace("\\", "/")
        for archivo in raiz.rglob("*.py")
        if "tests" not in archivo.parts and "permitir_salud" in archivo.read_text(encoding="utf-8")
    }
    assert usan == {"nova/chat.py", "nova/nucleo.py", "nova/seudonimos.py"}
    fuente = (raiz / "nova" / "chat.py").read_text(encoding="utf-8")
    assert fuente.count("permitir_salud_general=") == 1
    assert "permitir_salud_general=general," in fuente
    assert "general = modo == GENERAL" in fuente
