"""El cliente compartido: elección del proveedor, Anthropic con el SDK
(parcheado) y Gemini con `requests.post` (parcheado). Nunca llama a la red."""

from unittest import mock

import anthropic
import httpx2
import pytest

from apps.nova import cliente

pytestmark = pytest.mark.django_db


def _peticion(**extra):
    return cliente.PeticionIA(turnos=[{"rol": "usuario", "texto": "datos"}], **extra)


@pytest.mark.parametrize(
    ("proveedor", "anthropic_key", "gemini_key", "esperado"),
    [
        ("", "a", "g", "anthropic"),
        ("", "", "g", "gemini"),
        ("", "", "", None),
        ("gemini", "a", "g", "gemini"),
        ("anthropic", "", "g", None),
        ("otro", "a", "g", None),
    ],
)
def test_eleccion_del_proveedor(settings, proveedor, anthropic_key, gemini_key, esperado):
    settings.IA_PROVEEDOR = proveedor
    settings.ANTHROPIC_API_KEY = anthropic_key
    settings.GEMINI_API_KEY = gemini_key
    assert cliente.proveedor() == esperado
    assert cliente.configurada() is (esperado is not None)


def test_sin_proveedor_no_llama(settings):
    with pytest.raises(cliente.ErrorIA) as error:
        cliente.generar(_peticion())
    assert error.value.codigo == "sin_clave"


def test_anthropic_usa_salidas_estructuradas_y_esfuerzo(proveedor_falso):
    proveedor_falso.respuesta = '{"a": "b"}'
    esquema = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]}
    respuesta = cliente.generar(
        _peticion(
            sistema="instrucción", json=True, esquema=esquema, esfuerzo="low", temperatura=0.4
        ),
        timeout=15,
    )
    assert respuesta.texto == '{"a": "b"}'
    assert respuesta.proveedor == "anthropic" and respuesta.modelo == "claude-opus-5-5"
    assert (respuesta.tokens_entrada, respuesta.tokens_salida) == (120, 45)
    (pedido,) = proveedor_falso.pedidos
    assert pedido["model"] == "claude-opus-5-5"
    assert pedido["system"] == "instrucción"
    assert pedido["output_config"] == {
        "effort": "low",
        "format": {"type": "json_schema", "schema": esquema},
    }
    # Claude Opus 5.5: ni `thinking` ni parámetros de muestreo (dan 400), sin prefill.
    for prohibido in ("thinking", "temperature", "top_p", "top_k"):
        assert prohibido not in pedido
    assert pedido["messages"][-1]["role"] == "user"


def test_anthropic_negativa_y_corte_son_errores(proveedor_falso):
    proveedor_falso.stop_reason = "refusal"
    with pytest.raises(cliente.ErrorIA) as error:
        cliente.generar(_peticion())
    assert error.value.codigo == "rechazo"
    proveedor_falso.stop_reason = "max_tokens"
    with pytest.raises(cliente.ErrorIA) as error:
        cliente.generar(_peticion())
    assert error.value.codigo == "respuesta_invalida"


def _respuesta_http(status):
    return httpx2.Response(status, request=httpx2.Request("POST", "https://api.example.com"))


@pytest.mark.parametrize(
    ("excepcion", "codigo", "estado"),
    [
        (
            lambda: anthropic.RateLimitError("límite", response=_respuesta_http(429), body=None),
            "error_http",
            429,
        ),
        (
            lambda: anthropic.InternalServerError(
                "caído", response=_respuesta_http(500), body=None
            ),
            "error_http",
            500,
        ),
        (
            lambda: anthropic.APIConnectionError(request=httpx2.Request("POST", "https://x")),
            "sin_conexion",
            None,
        ),
        (
            lambda: anthropic.APITimeoutError(request=httpx2.Request("POST", "https://x")),
            "sin_conexion",
            None,
        ),
    ],
)
def test_anthropic_errores_por_tipo(proveedor_falso, excepcion, codigo, estado):
    proveedor_falso.error = excepcion()
    with pytest.raises(cliente.ErrorIA) as error:
        cliente.generar(_peticion())
    assert (error.value.codigo, error.value.status_code) == (codigo, estado)


def test_gemini_arma_su_payload(settings):
    settings.IA_PROVEEDOR = "gemini"
    settings.GEMINI_API_KEY = "clave-de-prueba"
    settings.GEMINI_MODEL = "principal"
    settings.GEMINI_MODELOS_RESPALDO = []
    ok = mock.Mock(status_code=200)
    ok.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "hola"}]}}],
        "usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 3},
    }
    with mock.patch("apps.nova.cliente.requests.post", return_value=ok) as post:
        respuesta = cliente.generar(
            _peticion(sistema="s", json=True, max_tokens=100, temperatura=0.5)
        )
    assert (respuesta.texto, respuesta.proveedor, respuesta.tokens_entrada) == ("hola", "gemini", 9)
    payload = post.call_args.kwargs["json"]
    assert payload["systemInstruction"] == {"parts": [{"text": "s"}]}
    assert payload["generationConfig"] == {
        "maxOutputTokens": 100,
        "temperature": 0.5,
        "responseMimeType": "application/json",
    }
    assert post.call_args.kwargs["headers"] == {"x-goog-api-key": "clave-de-prueba"}


def test_gemini_un_modelo_colgado_no_se_come_todo_el_plazo(settings):
    """09/11/2026: «gemini-flash-latest» no respondía ni en 60 s y el chat se
    quedaba sin tiempo antes de probar los de respaldo."""
    import requests

    settings.IA_PROVEEDOR = "gemini"
    settings.GEMINI_API_KEY = "clave-de-prueba"
    settings.GEMINI_MODEL = "colgado"
    settings.GEMINI_MODELOS_RESPALDO = ["rapido", "otro"]
    ok = mock.Mock(status_code=200)
    ok.json.return_value = {"candidates": [{"content": {"parts": [{"text": "hola"}]}}]}
    with (
        mock.patch("apps.nova.cliente.requests.post", side_effect=[requests.Timeout(), ok]) as post,
        mock.patch("apps.nova.cliente.time.sleep"),
    ):
        respuesta = cliente._generar_gemini(_peticion(), timeout=45, presupuesto=45)
    assert respuesta.texto == "hola"
    assert post.call_args_list[1].args[0].endswith("/rapido:generateContent")
    # El colgado tuvo su tope (45 s / 3 modelos), no los 45 s enteros.
    assert post.call_args_list[0].kwargs["timeout"] == 15


def test_extraer_json():
    assert cliente.extraer_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert cliente.extraer_json("nada") is None
