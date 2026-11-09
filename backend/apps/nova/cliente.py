"""Cliente de IA compartido por toda la intranet, independiente del proveedor
(09/11/2026).

Dos proveedores, uno activo a la vez:

- **Anthropic (Claude)**, con el SDK oficial `anthropic` (`ANTHROPIC_API_KEY`,
  `ANTHROPIC_MODEL`, por defecto `claude-haiku-5-5`, el más económico: decisión del usuario, 09/11/2026).
- **Gemini (Google)**, con el código que antes vivía solo en Cartera
  (`apps.cartera.services.dashboard_interpretation`): REST con `requests` a
  `generativelanguage.googleapis.com`, la clave en el encabezado
  `x-goog-api-key` (nunca en la URL) y modelos de respaldo (`GEMINI_MODEL`,
  luego `GEMINI_MODELOS_RESPALDO`).

Cuál se usa lo decide `IA_PROVEEDOR` («anthropic» o «gemini»). Vacío, se elige
solo: Anthropic si hay `ANTHROPIC_API_KEY`; si no, Gemini si hay
`GEMINI_API_KEY`; si no hay ninguna, no hay IA y cada función muestra su
versión sin IA. Si `IA_PROVEEDOR` nombra un proveedor sin clave, tampoco hay IA
(no se cambia de proveedor a escondidas: los datos irían a otra empresa).

Este módulo es **solo el transporte**: no sabe de personas, permisos,
seudónimos ni registro de uso. Lo que lleva datos de personas pasa antes por
`apps.nova.nucleo` (seudónimos, sin salud, límite, registro). Cartera lo usa
directo porque manda cifras de cartera, no datos de personas.

Las pruebas nunca llaman a un proveedor real: parchean `requests.post`
(Gemini) o `apps.nova.cliente.anthropic.Anthropic` (Anthropic).
"""

import json
import logging
import re
import time
from dataclasses import dataclass

import anthropic
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

ANTHROPIC = "anthropic"
GEMINI = "gemini"
PROVEEDORES = (ANTHROPIC, GEMINI)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Gemini responde 503 UNAVAILABLE ("high demand") de forma intermitente y POR
# MODELO: pasar al siguiente de la lista suele resolver en el acto.
ESTADOS_REINTENTABLES = frozenset({429, 500, 502, 503, 504})
# Un modelo que no existe (404) no mejora esperando, pero el siguiente puede andar.
ESTADO_MODELO_AUSENTE = 404
ESPERA_ENTRE_INTENTOS_SEGUNDOS = 1.5

#: Tope de salida en Anthropic cuando el pedido no fija uno. En Claude Opus 5.5
#: el razonamiento (siempre activo) consume del mismo tope.
MAX_TOKENS_POR_DEFECTO = 8192


class ErrorIA(Exception):
    """La IA no dio una respuesta utilizable.

    `codigo` es estable y es lo que se registra (nunca el contenido):
    - `sin_clave`: no hay proveedor con clave en este entorno.
    - `sin_conexion`: fallo de red o de tiempo.
    - `error_http`: el servicio respondió con un error (`status_code`).
    - `rechazo`: el modelo se negó a responder (Anthropic, `stop_reason`
      «refusal»).
    - `respuesta_invalida`: respondió sin el texto esperado (o cortado).
    """

    def __init__(self, codigo: str, mensaje: str, status_code: int | None = None):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.status_code = status_code


@dataclass
class PeticionIA:
    """Un pedido independiente del proveedor."""

    #: Turnos en orden: [{"rol": "usuario"|"modelo", "texto": str}]. El último
    #: es de la persona usuaria.
    turnos: list[dict]
    #: Instrucción del sistema (opcional).
    sistema: str | None = None
    #: Pedir la respuesta en JSON.
    json: bool = False
    #: Esquema JSON de la respuesta. Anthropic lo exige con salidas
    #: estructuradas (`output_config.format`); Gemini solo pide JSON.
    esquema: dict | None = None
    #: Tope de salida. None: el del proveedor (en Gemini, sin tope explícito).
    max_tokens: int | None = None
    #: Solo Gemini (Claude Opus 5.5 rechaza `temperature`).
    temperatura: float | None = None
    #: Solo Anthropic: «low», «medium» o «high» (`output_config.effort`).
    esfuerzo: str = "medium"


@dataclass(frozen=True)
class RespuestaIA:
    texto: str
    modelo: str
    proveedor: str = ""
    tokens_entrada: int = 0
    tokens_salida: int = 0


# ── Proveedor activo ─────────────────────────────────────────────────────────


def _clave(nombre: str) -> str:
    return getattr(settings, nombre, "") or ""


def proveedor() -> str | None:
    """El proveedor activo, o None si no hay IA en este entorno."""
    elegido = (getattr(settings, "IA_PROVEEDOR", "") or "").strip().lower()
    if elegido == ANTHROPIC:
        return ANTHROPIC if _clave("ANTHROPIC_API_KEY") else None
    if elegido == GEMINI:
        return GEMINI if _clave("GEMINI_API_KEY") else None
    if elegido:
        logger.error("IA_PROVEEDOR desconocido: %s (se esperaba anthropic o gemini)", elegido)
        return None
    if _clave("ANTHROPIC_API_KEY"):
        return ANTHROPIC
    if _clave("GEMINI_API_KEY"):
        return GEMINI
    return None


def configurada() -> bool:
    return proveedor() is not None


def generar(peticion: PeticionIA, *, timeout: float = 45, presupuesto: float = 50) -> RespuestaIA:
    """Pide el texto al proveedor activo. `timeout` es por llamada y
    `presupuesto` el total (Gemini puede probar varios modelos)."""
    activo = proveedor()
    if activo == ANTHROPIC:
        return _generar_anthropic(peticion, timeout=min(timeout, presupuesto))
    if activo == GEMINI:
        return _generar_gemini(peticion, timeout=timeout, presupuesto=presupuesto)
    raise ErrorIA("sin_clave", "La IA no está configurada en este entorno.")


# ── Anthropic ────────────────────────────────────────────────────────────────


def _generar_anthropic(peticion: PeticionIA, *, timeout: float) -> RespuestaIA:
    modelo = getattr(settings, "ANTHROPIC_MODEL", "") or "claude-haiku-5-5"
    # Sin reintentos del SDK: el tiempo de quien espera ya está acotado y, si
    # falla, la función muestra su versión sin IA.
    sdk = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=timeout, max_retries=0)
    mensajes = [
        {"role": "assistant" if t.get("rol") == "modelo" else "user", "content": t["texto"]}
        for t in peticion.turnos
    ]
    # Sin `thinking` (en Claude Opus 5.5 es adaptativo y siempre activo) ni
    # `temperature`/`top_p`/`top_k` (dan 400). El gasto se controla con
    # `effort`; el JSON, con salidas estructuradas y no solo con el prompt.
    output_config = {"effort": peticion.esfuerzo or "medium"}
    if peticion.esquema:
        output_config["format"] = {"type": "json_schema", "schema": peticion.esquema}
    parametros = {
        "model": modelo,
        "max_tokens": peticion.max_tokens or MAX_TOKENS_POR_DEFECTO,
        "messages": mensajes,
        "output_config": output_config,
    }
    if peticion.sistema:
        parametros["system"] = peticion.sistema

    try:
        respuesta = sdk.messages.create(**parametros)
    except anthropic.RateLimitError:
        logger.warning("Anthropic: límite de uso (429) con el modelo %s", modelo)
        raise ErrorIA("error_http", "El servicio de IA está saturado.", status_code=429) from None
    except anthropic.APIStatusError as error:
        logger.warning("Anthropic respondió %s con el modelo %s", error.status_code, modelo)
        raise ErrorIA(
            "error_http", "El servicio de IA respondió con un error.", status_code=error.status_code
        ) from None
    except anthropic.APIConnectionError:
        # Incluye `APITimeoutError`.
        logger.warning("Falló la conexión con Anthropic (modelo=%s)", modelo, exc_info=True)
        raise ErrorIA("sin_conexion", "No se pudo contactar al servicio de IA.") from None

    motivo = getattr(respuesta, "stop_reason", None)
    if motivo == "refusal":
        raise ErrorIA("rechazo", "El servicio de IA no quiso responder este pedido.")
    if motivo == "max_tokens":
        logger.warning("Anthropic cortó la respuesta por max_tokens (modelo=%s)", modelo)
        raise ErrorIA("respuesta_invalida", "La respuesta de la IA quedó incompleta.")
    texto = "".join(
        getattr(b, "text", "") for b in respuesta.content or [] if getattr(b, "type", "") == "text"
    ).strip()
    if not texto:
        raise ErrorIA("respuesta_invalida", "El servicio de IA no devolvió texto.")
    uso = getattr(respuesta, "usage", None)
    return RespuestaIA(
        texto=texto,
        modelo=getattr(respuesta, "model", None) or modelo,
        proveedor=ANTHROPIC,
        tokens_entrada=int(getattr(uso, "input_tokens", 0) or 0),
        tokens_salida=int(getattr(uso, "output_tokens", 0) or 0),
    )


# ── Gemini ───────────────────────────────────────────────────────────────────


def modelos_a_probar() -> list[str]:
    """El modelo de Gemini configurado primero, después los de respaldo, sin repetir."""
    modelos = [settings.GEMINI_MODEL]
    for modelo in settings.GEMINI_MODELOS_RESPALDO:
        if modelo and modelo not in modelos:
            modelos.append(modelo)
    return modelos


def payload_gemini(peticion: PeticionIA) -> dict:
    payload = {
        "contents": [
            {
                "role": "model" if t.get("rol") == "modelo" else "user",
                "parts": [{"text": t["texto"]}],
            }
            for t in peticion.turnos
        ]
    }
    if peticion.sistema:
        payload["systemInstruction"] = {"parts": [{"text": peticion.sistema}]}
    configuracion = {}
    if peticion.max_tokens:
        configuracion["maxOutputTokens"] = peticion.max_tokens
    if peticion.temperatura is not None:
        configuracion["temperature"] = peticion.temperatura
    if peticion.json:
        configuracion["responseMimeType"] = "application/json"
    if configuracion:
        payload["generationConfig"] = configuracion
    return payload


def _texto_gemini(cuerpo) -> str:
    try:
        return cuerpo["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        logger.error("Respuesta inesperada de Gemini: %s", str(cuerpo)[:500])
        raise ErrorIA(
            "respuesta_invalida", "El servicio de IA no devolvió una respuesta utilizable."
        ) from None


def _tokens_gemini(cuerpo) -> tuple[int, int]:
    uso = cuerpo.get("usageMetadata") if isinstance(cuerpo, dict) else None
    if not isinstance(uso, dict):
        return 0, 0
    try:
        return int(uso.get("promptTokenCount") or 0), int(uso.get("candidatesTokenCount") or 0)
    except (TypeError, ValueError):
        return 0, 0


def _generar_gemini(peticion: PeticionIA, *, timeout: float, presupuesto: float) -> RespuestaIA:
    """Un intento por modelo, hasta que uno responda o se acabe `presupuesto`.
    Un 4xx que no sea 429 ni 404 corta enseguida: es un problema del pedido."""
    payload = payload_gemini(peticion)
    comenzo = time.monotonic()
    modelos = modelos_a_probar()
    ultimo_estado = None

    for indice, modelo in enumerate(modelos):
        restante = presupuesto - (time.monotonic() - comenzo)
        if restante <= 1:
            break
        if indice:
            time.sleep(ESPERA_ENTRE_INTENTOS_SEGUNDOS)

        try:
            respuesta = requests.post(
                GEMINI_URL.format(model=modelo),
                headers={"x-goog-api-key": settings.GEMINI_API_KEY},
                json=payload,
                timeout=min(timeout, restante),
            )
        except requests.RequestException:
            logger.warning("Falló la llamada a Gemini (modelo=%s)", modelo, exc_info=True)
            ultimo_estado = None
            continue

        if respuesta.status_code == 200:
            if indice:
                logger.info('Gemini respondió con el modelo de respaldo "%s".', modelo)
            cuerpo = respuesta.json()
            entrada, salida = _tokens_gemini(cuerpo)
            return RespuestaIA(
                texto=_texto_gemini(cuerpo),
                modelo=modelo,
                proveedor=GEMINI,
                tokens_entrada=entrada,
                tokens_salida=salida,
            )

        ultimo_estado = respuesta.status_code
        reintentable = respuesta.status_code in ESTADOS_REINTENTABLES
        ausente = respuesta.status_code == ESTADO_MODELO_AUSENTE
        logger.warning(
            'Gemini respondió %s con el modelo "%s": %s',
            respuesta.status_code,
            modelo,
            respuesta.text[:300],
        )
        if not reintentable and not ausente:
            break

    logger.error(
        "Ningún modelo de Gemini respondió (probados: %s; último estado: %s).",
        ", ".join(modelos),
        ultimo_estado,
    )
    if ultimo_estado is None:
        raise ErrorIA("sin_conexion", "No se pudo contactar al servicio de IA.")
    raise ErrorIA(
        "error_http", "El servicio de IA respondió con un error.", status_code=ultimo_estado
    )


# ── Utilidades ───────────────────────────────────────────────────────────────


def extraer_json(texto: str):
    """El primer objeto JSON del texto (Gemini a veces lo envuelve en un bloque
    de código). None si no hay ninguno."""
    limpio = (texto or "").strip()
    try:
        return json.loads(limpio)
    except (json.JSONDecodeError, TypeError):
        pass
    encontrado = re.search(r"\{[\s\S]*\}", limpio)
    if not encontrado:
        return None
    try:
        return json.loads(encontrado.group(0))
    except json.JSONDecodeError:
        return None
