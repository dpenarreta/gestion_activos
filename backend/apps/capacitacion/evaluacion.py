"""Los tipos de pregunta de las evaluaciones del onboarding (22/10/2026).

- **unica** («Marcar la correcta»): una sola opción correcta; todo o nada.
- **multiple** («Opción múltiple»): marcar todas las correctas. Proporcional:
  (correctas marcadas − incorrectas marcadas) / correctas, nunca menos de 0.
- **completar**: una frase o párrafo con espacios en blanco, escritos en el
  texto como «[[palabra]]»; se aceptan alternativas («[[casa|hogar]]»).
  Proporcional por espacio; no distingue mayúsculas, tildes ni espacios de
  más.
- **unir**: parejas «concepto → respuesta» (`Opcion.texto` → `Opcion.pareja`).
  Las respuestas se muestran mezcladas; proporcional por pareja.

Cada pregunta vale sus `puntos` y la evaluación suma **10**. La nota es la
suma de lo obtenido (sobre 10) y aprueba si llega al porcentaje del material
(`Material.nota_minima`). Las respuestas correctas nunca se envían a quien
rinde la evaluación.
"""

import random
import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal

from rest_framework.exceptions import ValidationError

TOTAL = Decimal("10")
TIPOS = {
    "unica": "Marcar la correcta",
    "multiple": "Opción múltiple",
    "completar": "Completar espacios",
    "unir": "Unir con su respuesta",
}
HUECO = re.compile(r"\[\[([^\[\]]+)\]\]")


def normalizar(texto) -> str:
    texto = unicodedata.normalize("NFD", str(texto or "").strip().lower())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", texto)


def huecos(texto: str) -> list[list[str]]:
    """Las respuestas aceptadas de cada espacio, en orden."""
    return [
        [alternativa.strip() for alternativa in m.group(1).split("|") if alternativa.strip()]
        for m in HUECO.finditer(texto or "")
    ]


def segmentos(texto: str) -> list:
    """El texto partido en trozos: cadenas y `None` donde va un espacio."""
    partes, ultimo = [], 0
    for m in HUECO.finditer(texto or ""):
        partes.append(texto[ultimo : m.start()])
        partes.append(None)
        ultimo = m.end()
    partes.append((texto or "")[ultimo:])
    return [p for p in partes if p != ""]


def texto_visible(pregunta) -> str:
    """La pregunta como la lee la persona (los espacios como «____»)."""
    if pregunta.tipo == "completar":
        return HUECO.sub("____", pregunta.texto)
    return pregunta.texto


def _redondear(valor: Decimal) -> Decimal:
    return valor.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# --- Lo que ve quien rinde --------------------------------------------------------------


def presentar(pregunta) -> dict:
    datos = {
        "id": pregunta.id,
        "tipo": pregunta.tipo,
        "texto": texto_visible(pregunta),
        "puntos": str(pregunta.puntos),
    }
    opciones = list(pregunta.opciones.all())
    if pregunta.tipo in ("unica", "multiple"):
        datos["opciones"] = [{"id": o.id, "texto": o.texto} for o in opciones]
    elif pregunta.tipo == "completar":
        datos["segmentos"] = segmentos(pregunta.texto)
        datos["huecos"] = len(huecos(pregunta.texto))
    elif pregunta.tipo == "unir":
        datos["izquierda"] = [{"id": o.id, "texto": o.texto} for o in opciones]
        derecha = [o.pareja for o in opciones]
        # Mezcladas, pero siempre igual para la misma pregunta: recargar la
        # página no cambia el orden mientras se responde.
        random.Random(pregunta.id).shuffle(derecha)
        datos["derecha"] = derecha
    return datos


# --- Calificar -----------------------------------------------------------------------------


def _fraccion(pregunta, respuesta) -> Decimal:
    """Qué parte de la pregunta acertó, de 0 a 1."""
    opciones = list(pregunta.opciones.all())
    if pregunta.tipo == "unica":
        correctas = {o.id for o in opciones if o.correcta}
        try:
            return Decimal(1) if int(respuesta) in correctas else Decimal(0)
        except (TypeError, ValueError):
            return Decimal(0)
    if pregunta.tipo == "multiple":
        correctas = {o.id for o in opciones if o.correcta}
        try:
            marcadas = {int(x) for x in (respuesta or [])}
        except (TypeError, ValueError):
            return Decimal(0)
        if not correctas:
            return Decimal(0)
        neto = len(marcadas & correctas) - len(marcadas - correctas)
        return max(Decimal(0), Decimal(neto) / Decimal(len(correctas)))
    if pregunta.tipo == "completar":
        esperadas = huecos(pregunta.texto)
        escritas = list(respuesta or []) if isinstance(respuesta, list) else []
        if not esperadas:
            return Decimal(0)
        aciertos = sum(
            1
            for i, aceptadas in enumerate(esperadas)
            if i < len(escritas) and normalizar(escritas[i]) in {normalizar(a) for a in aceptadas}
        )
        return Decimal(aciertos) / Decimal(len(esperadas))
    if pregunta.tipo == "unir":
        elegidas = respuesta if isinstance(respuesta, dict) else {}
        if not opciones:
            return Decimal(0)
        aciertos = sum(
            1
            for o in opciones
            if normalizar(elegidas.get(str(o.id), elegidas.get(o.id, ""))) == normalizar(o.pareja)
        )
        return Decimal(aciertos) / Decimal(len(opciones))
    return Decimal(0)


def calificar(preguntas, respuestas: dict) -> dict:
    """La nota (sobre 10), el porcentaje y qué preguntas no estuvieron del todo
    bien."""
    nota = Decimal(0)
    falladas = []
    # Lo obtenido en cada pregunta, para que el resultado diga qué estuvo bien
    # en parte (auditoría UX/UI, 30/10/2026); nunca cuál era la correcta.
    detalle = []
    for pregunta in preguntas:
        respuesta = respuestas.get(str(pregunta.id), respuestas.get(pregunta.id))
        fraccion = _fraccion(pregunta, respuesta)
        obtenidos = Decimal(pregunta.puntos) * fraccion
        nota += obtenidos
        detalle.append((pregunta, _redondear(obtenidos)))
        if fraccion < 1:
            falladas.append(pregunta)
    total = sum((Decimal(p.puntos) for p in preguntas), Decimal(0)) or TOTAL
    nota = _redondear(nota * TOTAL / total)
    return {
        "nota": nota,
        "porcentaje": int((nota * 10).to_integral_value(rounding=ROUND_HALF_UP)),
        "falladas": falladas,
        "detalle": detalle,
    }


# --- Validar lo que se guarda (quien gestiona) ----------------------------------------------


def validar(preguntas: list[dict]) -> list[dict]:
    """Cada pregunta según su tipo, y que los puntos sumen 10. Devuelve las
    preguntas limpias, listas para guardar."""
    limpias = []
    suma = Decimal(0)
    for i, p in enumerate(preguntas, start=1):
        tipo = p.get("tipo") or "unica"
        if tipo not in TIPOS:
            raise ValidationError({"preguntas": f"La pregunta {i} tiene un tipo desconocido."})
        texto = (p.get("texto") or "").strip()
        if not texto:
            raise ValidationError({"preguntas": f"La pregunta {i} no tiene texto."})
        try:
            puntos = _redondear(Decimal(str(p.get("puntos"))))
        except Exception:
            raise ValidationError({"preguntas": f"La pregunta {i} no tiene puntos."}) from None
        if puntos <= 0:
            raise ValidationError({"preguntas": f"La pregunta {i} debe valer más de 0 puntos."})
        suma += puntos
        opciones = [
            {
                "texto": (o.get("texto") or "").strip(),
                "correcta": bool(o.get("correcta")),
                "pareja": (o.get("pareja") or "").strip(),
            }
            for o in p.get("opciones", [])
            if (o.get("texto") or "").strip()
        ]
        if tipo in ("unica", "multiple"):
            if len(opciones) < 2:
                raise ValidationError(
                    {"preguntas": f"La pregunta {i} necesita al menos dos opciones."}
                )
            correctas = sum(1 for o in opciones if o["correcta"])
            if tipo == "unica" and correctas != 1:
                raise ValidationError(
                    {"preguntas": f"Marque una sola respuesta correcta en la pregunta {i}."}
                )
            if tipo == "multiple" and correctas < 1:
                raise ValidationError(
                    {"preguntas": f"Marque al menos una respuesta correcta en la pregunta {i}."}
                )
        elif tipo == "completar":
            if not huecos(texto):
                raise ValidationError(
                    {
                        "preguntas": f"La pregunta {i} no tiene espacios: escriba la palabra "
                        "entre corchetes dobles, por ejemplo «El SRI exige el [[RUC]]»."
                    }
                )
            opciones = []
        elif tipo == "unir":
            if len(opciones) < 2 or any(not o["pareja"] for o in opciones):
                raise ValidationError(
                    {"preguntas": f"La pregunta {i} necesita al menos dos parejas completas."}
                )
        limpias.append({"tipo": tipo, "texto": texto, "puntos": puntos, "opciones": opciones})
    if limpias and suma != TOTAL:
        raise ValidationError(
            {"preguntas": f"Los puntos de las preguntas suman {suma} y deben sumar 10."}
        )
    return limpias
