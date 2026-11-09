"""El núcleo de Nova: la única puerta para mandar datos de personas a la IA.

Toda función de Nova (análisis de KPI, narrativa de informes, frase del inicio
y, después, el chat y la base de conocimiento) pide sus textos con `generar` o
`generar_varios`. El núcleo, en este orden:

1. **Puede llamar** (`motivo_para_no_llamar`): hay clave (`GEMINI_API_KEY`),
   la persona aceptó el aviso de datos vigente (`consentimiento.py`) y no llegó
   a su límite diario (`NOVA_LIMITE_DIARIO_POR_USUARIO`). Si no, no llama.
2. **Sanea** los datos con el `Seudonimizador` de la llamada (seudónimos, sin
   contacto, sin salud) y **verifica** el texto exacto que va a salir; si aún
   queda algo prohibido, no llama (`bloqueado`).
3. **Llama** al proveedor configurado (`cliente.py`: Anthropic o Gemini) con un tiempo máximo
   (`NOVA_TIEMPO_ESPERA_SEGUNDOS`, 15 s como Nexo, o `Pedido.tiempo`). Varios
   pedidos van en paralelo; solo la llamada al proveedor corre en hilos, el registro va en el hilo
   de la petición.
4. **Registra** el uso con metadatos (`UsoNova`), nunca el contenido.
5. **Repone** los nombres reales en la respuesta.

Nunca lanza por culpa de la IA: devuelve un `Resultado` con `con_ia=False`, el
`motivo` y un `mensaje` para la persona, y la función muestra su versión sin
IA (como Nexo). La función decide qué es «sin IA» para ella.

Para el chat (otro agente): `Pedido.historial` admite los turnos anteriores
(`[{"rol": "usuario"|"modelo", "texto": str}]`), que se sanean y verifican
igual que `datos`; `respuesta_json=False` devuelve texto libre en
`Resultado.texto`. El seudonimizador debe ser el mismo en toda la
conversación si se quiere que «Persona A» siga siendo la misma persona.
`sistema` (la instrucción del sistema) es texto del código: no debe llevar
datos de personas, por eso no se verifica.

**Salud en el modo General del chat** (decisión del 09/11/2026): con
`Pedido.permitir_salud_general=True` las menciones de salud como tema general
(«¿cuántos días de licencia por maternidad da la empresa?») y los fragmentos
de políticas salen completos. El núcleo solo lo respeta si la función es el
chat y los datos son del modo General, sin contexto de personas
(`_salud_permitida`); en cualquier otro caso se ignora y la salud se bloquea
como siempre. Nombres, correos, cédulas y teléfonos se limpian y verifican
igual en todos los casos.
"""

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from datetime import time as dt_time
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from . import cliente
from .consentimiento import acepto_aviso_vigente
from .models import UsoNova
from .seudonimos import EnvioBloqueado, Seudonimizador

logger = logging.getLogger(__name__)

R = UsoNova.Resultado

#: Lo que ve la persona cuando no hubo IA, por motivo.
MENSAJES = {
    R.SIN_CLAVE: "Nova no está configurada en este entorno: se muestra la versión sin IA.",
    R.SIN_CONSENTIMIENTO: (
        "Para usar Nova debe aceptar el aviso de tratamiento de datos vigente. Mientras tanto "
        "se muestra la versión sin IA."
    ),
    R.BLOQUEADO: (
        "Por privacidad, este contenido no se envió a la IA: se muestra la versión sin IA."
    ),
    R.FALLO: "Nova no respondió a tiempo: se muestra la versión sin IA. Intente más tarde.",
}


def mensaje_de_limite(limite: int) -> str:
    return (
        f"Alcanzó el límite de {limite} consultas diarias a Nova. Podrá volver a usarla mañana; "
        "mientras tanto se muestra la versión sin IA."
    )


# ── Configuración ────────────────────────────────────────────────────────────


def limite_diario() -> int:
    return max(0, int(getattr(settings, "NOVA_LIMITE_DIARIO_POR_USUARIO", 40)))


def tiempo_espera() -> float:
    return float(getattr(settings, "NOVA_TIEMPO_ESPERA_SEGUNDOS", 15))


def ttl_cache_segundos() -> int:
    return max(0, int(getattr(settings, "NOVA_CACHE_MINUTOS", 60))) * 60


def clave_cache(funcion: str, *partes) -> str:
    """Clave de caché de una función de Nova. Quien consulta va SIEMPRE entre
    las partes cuando el texto depende de lo que esa persona puede ver (lección
    de Nexo: una caché sin el consultante salta la autorización)."""
    return "nova:" + ":".join([funcion, *(str(p) for p in partes)])


def leer_cache(clave: str):
    return cache.get(clave) if ttl_cache_segundos() else None


def guardar_cache(clave: str, valor) -> None:
    if ttl_cache_segundos():
        cache.set(clave, valor, ttl_cache_segundos())


# ── Límite y estado ──────────────────────────────────────────────────────────


def _inicio_de_hoy() -> datetime:
    hoy = timezone.localdate()
    return timezone.make_aware(datetime.combine(hoy, dt_time.min))


def usos_de_hoy(usuario) -> int:
    """Las llamadas al proveedor de hoy (lo que cuenta para el límite)."""
    return UsoNova.objects.filter(
        usuario=usuario, creado__gte=_inicio_de_hoy(), llamada=True
    ).count()


def motivo_para_no_llamar(usuario, cantidad: int = 1) -> tuple[str, str] | None:
    """`(motivo, mensaje)` si no se puede llamar a la IA para `cantidad`
    pedidos; None si se puede."""
    if not cliente.configurada():
        return R.SIN_CLAVE, MENSAJES[R.SIN_CLAVE]
    if not acepto_aviso_vigente(usuario):
        return R.SIN_CONSENTIMIENTO, MENSAJES[R.SIN_CONSENTIMIENTO]
    limite = limite_diario()
    if usos_de_hoy(usuario) + cantidad > limite:
        return R.LIMITE, mensaje_de_limite(limite)
    return None


def estado(usuario) -> dict:
    """Para la pantalla: si Nova está disponible para esta persona y cuánto
    le queda hoy."""
    limite = limite_diario()
    usados = usos_de_hoy(usuario)
    motivo = motivo_para_no_llamar(usuario)
    return {
        "configurada": cliente.configurada(),
        "consentimiento": acepto_aviso_vigente(usuario),
        "limite_diario": limite,
        "usados_hoy": usados,
        "disponibles_hoy": max(0, limite - usados),
        "disponible": motivo is None,
        "motivo": motivo[0] if motivo else None,
        "mensaje": motivo[1] if motivo else None,
    }


# ── Pedidos y resultados ─────────────────────────────────────────────────────


@dataclass
class Pedido:
    #: Instrucción del sistema (texto del código, sin datos de personas).
    sistema: str
    #: Los datos ya calculados (dict/list/str). Se sanean y se envían en JSON.
    datos: Any
    respuesta_json: bool = True
    #: Esquema JSON de la respuesta (con Anthropic, salidas estructuradas).
    esquema: dict | None = None
    #: Tope de salida. En Claude Opus 5.5 el razonamiento consume del mismo
    #: tope: déjelo holgado.
    max_tokens: int = 8192
    #: Solo Gemini (Claude Opus 5.5 no la admite).
    temperatura: float | None = None
    #: Solo Anthropic: «low» para frases cortas, «medium» para análisis.
    esfuerzo: str = "medium"
    #: Tiempo máximo propio (segundos); None: `NOVA_TIEMPO_ESPERA_SEGUNDOS`.
    tiempo: float | None = None
    #: Turnos anteriores (chat): [{"rol": "usuario"|"modelo", "texto": str}].
    historial: list[dict] = field(default_factory=list)
    #: Solo el modo General del chat: deja salir las menciones de salud como
    #: tema general. El núcleo lo ignora fuera de ese caso (`_salud_permitida`).
    permitir_salud_general: bool = False


@dataclass
class Resultado:
    con_ia: bool
    #: None con IA; si no, un `UsoNova.Resultado`.
    motivo: str | None = None
    #: Para la persona, cuando no hubo IA.
    mensaje: str | None = None
    #: La respuesta con los nombres reales repuestos.
    texto: str | None = None
    #: Con `respuesta_json`, la respuesta interpretada (nombres repuestos) o
    #: None si no era JSON válido (se trata como fallo).
    datos: Any = None

    @classmethod
    def sin_ia(cls, motivo: str, mensaje: str | None = None) -> "Resultado":
        return cls(con_ia=False, motivo=motivo, mensaje=mensaje or MENSAJES.get(motivo))


def _registrar(usuario, funcion: str, resultado: str, **campos) -> None:
    try:
        UsoNova.objects.create(usuario=usuario, funcion=funcion, resultado=resultado, **campos)
    except Exception:  # noqa: BLE001 — el registro nunca rompe la función
        logger.exception("[nova] no se pudo registrar el uso")


#: La única función y el único modo en que se permite mencionar salud
#: (`chat.FUNCION` y `chat.GENERAL`; aquí para no importar el chat).
FUNCION_CHAT = "chat"
MODO_CHAT_GENERAL = "general"
#: Claves de contexto con datos de personas: con ellas nunca sale salud.
_CONTEXTO_DE_PERSONAS = ("persona_que_pregunta", "tareas", "equipo")


def _salud_permitida(funcion: str, pedido: Pedido) -> bool:
    """Si este pedido puede llevar menciones de salud como tema general: solo
    el chat, en modo General y sin contexto de personas. Cualquier otro uso
    del indicador se ignora."""
    datos = pedido.datos
    return (
        pedido.permitir_salud_general is True
        and funcion == FUNCION_CHAT
        and isinstance(datos, dict)
        and datos.get("modo") == MODO_CHAT_GENERAL
        and not any(clave in datos for clave in _CONTEXTO_DE_PERSONAS)
    )


def _peticion(pedido: Pedido, seud: Seudonimizador, funcion: str = "") -> cliente.PeticionIA:
    """El pedido neutro del cliente, con todos los turnos ya saneados y
    verificados (`EnvioBloqueado` si algo no debe salir)."""
    # El parámetro solo se pasa cuando aplica: el resto de llamadas no cambia.
    opciones = {"permitir_salud": True} if _salud_permitida(funcion, pedido) else {}
    turnos = []
    for turno in pedido.historial:
        texto = seud.texto(turno.get("texto"), **opciones)
        seud.verificar(texto, **opciones)
        turnos.append(
            {"rol": "modelo" if turno.get("rol") == "modelo" else "usuario", "texto": texto}
        )
    datos = seud.sanear(pedido.datos, **opciones)
    texto = datos if isinstance(datos, str) else json.dumps(datos, ensure_ascii=False)
    seud.verificar(texto, **opciones)
    turnos.append({"rol": "usuario", "texto": texto})
    return cliente.PeticionIA(
        turnos=turnos,
        sistema=pedido.sistema,
        json=pedido.respuesta_json,
        esquema=pedido.esquema if pedido.respuesta_json else None,
        max_tokens=pedido.max_tokens,
        temperatura=pedido.temperatura,
        esfuerzo=pedido.esfuerzo,
    )


def _llamar(peticion: cliente.PeticionIA, espera: float):
    """Solo la llamada al proveedor (corre en un hilo): devuelve
    `(RespuestaIA | ErrorIA, ms)`."""
    comenzo = time.monotonic()
    try:
        respuesta = cliente.generar(peticion, timeout=espera, presupuesto=espera)
    except cliente.ErrorIA as error:
        respuesta = error
    except Exception as error:  # noqa: BLE001 — nunca rompe la función
        logger.exception("[nova] error inesperado al llamar a la IA")
        respuesta = cliente.ErrorIA("sin_conexion", str(type(error).__name__))
    return respuesta, int((time.monotonic() - comenzo) * 1000)


def generar_varios(
    usuario, funcion: str, pedidos: list[Pedido], seud: Seudonimizador | None = None
) -> list[Resultado]:
    """Varios pedidos de una misma función que comparten seudónimos (p. ej.
    las cuatro secciones de la narrativa de un informe). Cuentan como
    `len(pedidos)` usos para el límite."""
    seud = seud or Seudonimizador()
    if not pedidos:
        return []

    bloqueo = motivo_para_no_llamar(usuario, len(pedidos))
    if bloqueo:
        motivo, mensaje = bloqueo
        _registrar(usuario, funcion, motivo)
        return [Resultado.sin_ia(motivo, mensaje) for _ in pedidos]

    resultados: list[Resultado | None] = [None] * len(pedidos)
    payloads: dict[int, cliente.PeticionIA] = {}
    for indice, pedido in enumerate(pedidos):
        try:
            payloads[indice] = _peticion(pedido, seud, funcion)
        except EnvioBloqueado as bloqueado:
            # Solo el motivo (qué tipo de dato), nunca el dato.
            logger.warning("[nova] envío bloqueado en %s: %s", funcion, bloqueado)
            _registrar(usuario, funcion, R.BLOQUEADO)
            resultados[indice] = Resultado.sin_ia(R.BLOQUEADO)

    def espera(i):
        return pedidos[i].tiempo or tiempo_espera()

    if len(payloads) == 1:
        ((indice, peticion),) = payloads.items()
        respuestas = {indice: _llamar(peticion, espera(indice))}
    elif payloads:
        with ThreadPoolExecutor(max_workers=len(payloads)) as hilos:
            futuros = {i: hilos.submit(_llamar, p, espera(i)) for i, p in payloads.items()}
            respuestas = {i: f.result() for i, f in futuros.items()}
    else:
        respuestas = {}

    for indice, (respuesta, ms) in respuestas.items():
        pedido = pedidos[indice]
        if isinstance(respuesta, cliente.ErrorIA):
            _registrar(
                usuario,
                funcion,
                R.SIN_CLAVE if respuesta.codigo == "sin_clave" else R.FALLO,
                proveedor=cliente.proveedor() or "",
                llamada=respuesta.codigo != "sin_clave",
                duracion_ms=ms,
            )
            resultados[indice] = Resultado.sin_ia(
                R.SIN_CLAVE if respuesta.codigo == "sin_clave" else R.FALLO
            )
            continue

        datos = None
        valido = True
        if pedido.respuesta_json:
            datos = cliente.extraer_json(respuesta.texto)
            valido = datos is not None
        _registrar(
            usuario,
            funcion,
            R.CON_IA if valido else R.FALLO,
            proveedor=respuesta.proveedor,
            modelo=respuesta.modelo[:80],
            tokens_entrada=respuesta.tokens_entrada,
            tokens_salida=respuesta.tokens_salida,
            exito=valido,
            llamada=True,
            duracion_ms=ms,
        )
        if not valido:
            resultados[indice] = Resultado.sin_ia(R.FALLO)
            continue
        resultados[indice] = Resultado(
            con_ia=True,
            texto=seud.reponer(respuesta.texto.strip()),
            datos=seud.reponer(datos) if datos is not None else None,
        )
    return resultados


def generar(usuario, funcion: str, pedido: Pedido, seud: Seudonimizador | None = None) -> Resultado:
    return generar_varios(usuario, funcion, [pedido], seud)[0]
