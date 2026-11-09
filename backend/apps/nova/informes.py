"""Narrativa con IA de los informes ejecutivos (Nexo:
`src/lib/executiveReporting/nova/generateNarrative.ts`, `prompts.ts`,
`confidence.ts`).

Cuatro pedidos en paralelo, cada uno con su tiempo máximo
(`NOVA_TIEMPO_ESPERA_INFORME_SEGUNDOS`, 60 s; en Nexo eran 15 s con un modelo
más rápido) y su respaldo sin IA: el resumen
ejecutivo, los hallazgos (insights), la evaluación y el enriquecimiento de las
recomendaciones. Los respaldos son los textos deterministas que el informe ya
traía (`apps.informes.narrativa`), así que la narrativa nunca queda en blanco y
el informe nunca falla por la IA.

Nova recibe el contexto condensado del informe (`derive_context`) con las
personas seudonimizadas: el «mejor» y el «que requiere atención», las de las
alertas y cualquier nombre que aparezca en los hallazgos o recomendaciones ya
redactados salen como «Persona A», «Persona B»… (las cuatro llamadas comparten
los seudónimos) y se reponen al volver.

Marca en el documento (lo lee el visor):
- `novaOrigen`: «NOVA» si al menos una sección es de la IA; «DETERMINISTA» si
  ninguna (sin permiso, sin clave, límite, fallo…).
- `novaSeccionesSinIa`: las secciones que quedaron con el texto sin IA.
- `novaDegraded`: se esperaba la IA (permiso y clave) y alguna sección no la
  tuvo.
- `novaAviso`: el mensaje para la persona cuando no hubo IA.
"""

import json
import time

from apps.informes.narrativa import (
    derive_context,
    executive_assessment,
    executive_insights,
    executive_summary,
    recommendation_enrichment,
)
from apps.permissions.authorization import user_has_permission

from . import cliente, nucleo
from .access import NARRATIVA_INFORMES
from .seudonimos import Seudonimizador

FUNCION = "informe"
NOVA_IA = "NOVA"
NOVA_DETERMINISTA = "DETERMINISTA"

SECCIONES = (
    "executiveSummary",
    "executiveInsights",
    "executiveAssessment",
    "recommendationEnrichment",
)

_REGLAS = """Actúas como un Consultor Senior en People Analytics, Gestión Humana, Desarrollo
Organizacional y Business Intelligence, nunca como un chatbot ni un redactor automático. Tu
personalidad es analítica, objetiva, ejecutiva, profesional y basada en evidencia. Escribes en
español, tratando de usted.

Recibirás un JSON con datos YA CALCULADOS por el motor de KPI de la intranet: nunca los calcules,
cuestiones ni recalcules. Nunca inventes causas, riesgos, fortalezas, oportunidades ni
recomendaciones que no estén respaldadas por ese JSON. Las personas aparecen con seudónimos
(«Persona A», «Persona B»…): refiérete a ellas exactamente así.

Toda conclusión sigue esta cadena: Datos → Interpretación → Impacto → Consecuencia →
Recomendación → Prioridad.

PROHIBIDO usar «parece», «probablemente», «tal vez», «podría ser», «se asume», «no existen
suficientes datos» o equivalentes. Si la evidencia no permite una conclusión firme, dilo así:
«la evidencia disponible no permite determinar X».

Nunca describas un dato («el cumplimiento fue 74%»): interprétalo (qué significa, por qué
importa, qué implica). Cruza indicadores cuando la relación sea evidente (cumplimiento alto +
carga excesiva → riesgo de sostenibilidad; carga baja + cumplimiento bajo → posible problema de
productividad).

Lenguaje directo, preciso y comprensible; frases cortas, sin jerga técnica ni lenguaje emocional o
de venta. Nunca alarmista ni ambiguo.

Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown."""


def confianza(ctx: dict) -> str:
    """Nivel de confianza interno (`confidence.ts`): gobierna cuánto puede
    profundizar el texto."""
    calidad = ctx["resumen"].get("dataQualityPct") or 0
    personas = ctx["meta"].get("collaboratorCount") or 0
    if personas == 0:
        return "Baja"
    if calidad >= 90 and personas >= 5:
        return "Muy Alta"
    if calidad >= 75 and personas >= 3:
        return "Alta"
    if calidad >= 50:
        return "Media"
    return "Baja"


def _instruccion_de_confianza(nivel: str) -> str:
    if nivel in ("Muy Alta", "Alta"):
        return (
            "El nivel de confianza de los datos es alto: puedes elaborar conclusiones con mayor "
            "profundidad."
        )
    if nivel == "Media":
        return (
            "El nivel de confianza de los datos es medio: mantén las conclusiones moderadas, sin "
            "sobre-extrapolar."
        )
    return (
        "El nivel de confianza de los datos es bajo (equipo pequeño o calidad de datos limitada): "
        "sé conservador y prioriza señalar qué no se puede determinar aún."
    )


_SECCION = {
    "executiveSummary": (
        "Generas el RESUMEN EJECUTIVO del informe, la sección más importante para un Director: "
        "debe leerse en menos de un minuto. Máximo 250 palabras EN TOTAL entre los 4 campos. "
        "Estructura: Situación general → Fortalezas → Aspectos de atención → Conclusión. No "
        "repitas indicadores textualmente, interprétalos. Forma exacta: "
        '{"situacionGeneral": string, "fortalezas": string, "aspectosAtencion": string, '
        '"conclusion": string}.'
    ),
    "executiveInsights": (
        "Generas los HALLAZGOS EJECUTIVOS: nivel de analista, NO un resumen de KPI (eso ya está "
        "en el resumen y en las páginas de indicadores). Identifica patrones, cambios relevantes, "
        "anomalías y relaciones cruzadas entre indicadores. Forma exacta: "
        '{"patrones": string[], "cambios": string[], "anomalias": string[], '
        '"relacionesCruzadas": string[]}, cada arreglo con 1 a 3 elementos; si uno no aplica, un '
        "único elemento que lo diga (nunca vacío)."
    ),
    "executiveAssessment": (
        "Generas la EVALUACIÓN EJECUTIVA: un análisis estratégico, no un resumen; no repitas lo "
        "del resumen ni de los hallazgos, profundiza. Máximo 700 palabras EN TOTAL. Orden "
        "obligatorio: Diagnóstico general → Fortalezas estratégicas → Riesgos detectados → "
        "Oportunidades → Prioridades → Perspectiva estratégica → Opinión ejecutiva. Cada "
        "fortaleza explica por qué lo es, su impacto y cómo aprovecharla; cada riesgo, qué es, "
        "por qué existe, su impacto y qué acción lo reduce; cada oportunidad, su retorno "
        "esperado. La opinión ejecutiva es un juicio profesional. Forma exacta: "
        '{"diagnosticoGeneral": string, "fortalezasEstrategicas": string[], '
        '"riesgosDetectados": string[], "oportunidades": string[], "prioridades": string[], '
        '"perspectivaEstrategica": string, "opinionEjecutiva": string}.'
    ),
    "recommendationEnrichment": (
        "Enriqueces una lista FIJA de recomendaciones ya generadas por reglas (campo "
        '"recomendaciones" del JSON, cada una con "id"). NUNCA agregues ni quites una: solo '
        'anotas cada "id" presente. Cada anotación es específica, accionable, medible y realista, '
        "nunca genérica. Forma exacta: "
        '{"enriquecimiento": [{"id": string, "justificacion": string, "impactoEsperado": string, '
        '"areaAfectada": string, "beneficio": string, "complejidadEstimada": string, '
        '"tiempoEstimado": string, "responsableSugerido": string}, ...]}, un objeto por CADA '
        '"id" recibido, en el mismo orden.'
    ),
}


def _objeto(textos=(), listas=()) -> dict:
    propiedades = {c: {"type": "string"} for c in textos}
    propiedades.update({c: {"type": "array", "items": {"type": "string"}} for c in listas})
    return {
        "type": "object",
        "properties": propiedades,
        "required": [*textos, *listas],
        "additionalProperties": False,
    }


#: Esquemas de salida (con Anthropic, salidas estructuradas).
ESQUEMAS = {
    "executiveSummary": _objeto(
        textos=("situacionGeneral", "fortalezas", "aspectosAtencion", "conclusion")
    ),
    "executiveInsights": _objeto(listas=("patrones", "cambios", "anomalias", "relacionesCruzadas")),
    "executiveAssessment": _objeto(
        textos=("diagnosticoGeneral", "perspectivaEstrategica", "opinionEjecutiva"),
        listas=("fortalezasEstrategicas", "riesgosDetectados", "oportunidades", "prioridades"),
    ),
    "recommendationEnrichment": {
        "type": "object",
        "properties": {
            "enriquecimiento": {
                "type": "array",
                "items": _objeto(
                    textos=(
                        "id",
                        "justificacion",
                        "impactoEsperado",
                        "areaAfectada",
                        "beneficio",
                        "complejidadEstimada",
                        "tiempoEstimado",
                        "responsableSugerido",
                    )
                ),
            }
        },
        "required": ["enriquecimiento"],
        "additionalProperties": False,
    },
}


def tiempo_espera() -> float:
    """El informe es un pedido deliberado y su narrativa es larga: tiene su
    propio tiempo máximo (`NOVA_TIEMPO_ESPERA_INFORME_SEGUNDOS`)."""
    from django.conf import settings

    return float(getattr(settings, "NOVA_TIEMPO_ESPERA_INFORME_SEGUNDOS", 60))


# ── Validación de cada sección (como Nexo: si falta algo, la sección no sirve) ─


def _texto(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def _lista(v) -> list[str] | None:
    if not isinstance(v, list):
        return None
    limpia = [x.strip() for x in v if _texto(x)]
    return limpia or None


def _validar_resumen(r) -> dict | None:
    campos = ("situacionGeneral", "fortalezas", "aspectosAtencion", "conclusion")
    if not isinstance(r, dict) or not all(_texto(r.get(c)) for c in campos):
        return None
    return {c: r[c].strip() for c in campos}


def _validar_hallazgos(r) -> dict | None:
    campos = ("patrones", "cambios", "anomalias", "relacionesCruzadas")
    if not isinstance(r, dict):
        return None
    listas = {c: _lista(r.get(c)) for c in campos}
    return listas if all(listas.values()) else None


def _validar_evaluacion(r) -> dict | None:
    textos = ("diagnosticoGeneral", "perspectivaEstrategica", "opinionEjecutiva")
    listas = ("fortalezasEstrategicas", "riesgosDetectados", "oportunidades", "prioridades")
    if not isinstance(r, dict) or not all(_texto(r.get(c)) for c in textos):
        return None
    valores = {c: _lista(r.get(c)) for c in listas}
    if not all(valores.values()):
        return None
    return {
        "diagnosticoGeneral": r["diagnosticoGeneral"].strip(),
        **{c: valores[c] for c in ("fortalezasEstrategicas", "riesgosDetectados")},
        "oportunidades": valores["oportunidades"],
        "prioridades": valores["prioridades"],
        "perspectivaEstrategica": r["perspectivaEstrategica"].strip(),
        "opinionEjecutiva": r["opinionEjecutiva"].strip(),
    }


_CAMPOS_ENRIQUECIMIENTO = (
    "justificacion",
    "impactoEsperado",
    "areaAfectada",
    "beneficio",
    "complejidadEstimada",
    "tiempoEstimado",
    "responsableSugerido",
)


def _validar_enriquecimiento(r, recomendaciones: list[dict]) -> list[dict] | None:
    """Realineado contra los `id` reales: los inventados se descartan y los
    omitidos se completan con su respaldo puntual."""
    lista = r.get("enriquecimiento") if isinstance(r, dict) else None
    if not isinstance(lista, list):
        return None
    por_id = {}
    for item in lista:
        if (
            isinstance(item, dict)
            and _texto(item.get("id"))
            and all(_texto(item.get(c)) for c in _CAMPOS_ENRIQUECIMIENTO)
        ):
            por_id[item["id"]] = {
                "id": item["id"],
                **{c: item[c].strip() for c in _CAMPOS_ENRIQUECIMIENTO},
            }
    if not por_id:
        return None
    respaldo = {e["id"]: e for e in recommendation_enrichment(recomendaciones)}
    return [por_id.get(rec["id"]) or respaldo[rec["id"]] for rec in recomendaciones]


# ── Contexto seudonimizado ───────────────────────────────────────────────────


def _con_alias(item: dict | None, seud: Seudonimizador) -> dict | None:
    if not item:
        return item
    clave = item.get("userId") or item.get("id") or item.get("name")
    return {**item, "name": seud.persona(item.get("name") or "", clave=clave)}


def contexto_seudonimizado(doc: dict, seud: Seudonimizador) -> dict:
    """El contexto de `derive_context` con las personas seudonimizadas. Se
    registran TODAS las del informe primero, para reconocerlas también en los
    textos ya redactados (hallazgos, recomendaciones)."""
    from django.contrib.auth import get_user_model

    miembros = doc.get("members") or []
    ids = [m.get("id") for m in miembros if isinstance(m.get("id"), int)]
    cuentas = {u.pk: u for u in get_user_model().objects.filter(pk__in=ids)}
    for m in miembros:
        cuenta = cuentas.get(m.get("id"))
        # El informe muestra el nombre corto; en los textos libres puede
        # aparecer completo, con el apellido, el usuario o el correo.
        otras = (
            [cuenta.get_full_name(), cuenta.last_name, cuenta.username, cuenta.email]
            if cuenta
            else []
        )
        seud.persona(m.get("name") or "", *otras, clave=m.get("id"))
    ctx = derive_context(doc)
    ctx["destacado"] = {
        "mejor": _con_alias(ctx["destacado"]["mejor"], seud),
        "atencion": _con_alias(ctx["destacado"]["atencion"], seud),
    }
    ctx["alertas"] = [_con_alias(a, seud) for a in ctx.get("alertas") or []]
    return ctx


# ── La función ───────────────────────────────────────────────────────────────


def narrar(actor, doc: dict) -> dict:
    """Pone en `doc` la narrativa con IA (o la deja sin IA) y sus marcas.
    Devuelve el mismo `doc`. Nunca lanza por la IA."""
    deterministas = doc.get("nova") or {}
    doc["novaOrigen"] = NOVA_DETERMINISTA
    doc["novaDegraded"] = False
    doc["novaSeccionesSinIa"] = list(SECCIONES)
    doc["novaAviso"] = None

    if not user_has_permission(actor, NARRATIVA_INFORMES):
        return doc

    comenzo = time.monotonic()
    seud = Seudonimizador()
    ctx = contexto_seudonimizado(doc, seud)
    nivel = _instruccion_de_confianza(confianza(ctx))
    # El JSON va como texto ya armado para que las cuatro secciones lean
    # exactamente lo mismo (el núcleo lo sanea y verifica igual).
    datos = json.loads(json.dumps(ctx, ensure_ascii=False, default=str))
    pedidos = [
        nucleo.Pedido(
            sistema=f"{_REGLAS}\n\n{_SECCION[seccion]} {nivel}",
            datos=datos,
            esquema=ESQUEMAS[seccion],
            max_tokens=16000,
            temperatura=0.4,
            esfuerzo="medium",
            tiempo=tiempo_espera(),
        )
        for seccion in SECCIONES
    ]
    resultados = nucleo.generar_varios(actor, FUNCION, pedidos, seud)

    recomendaciones = doc.get("recommendations") or []
    validadores = {
        "executiveSummary": _validar_resumen,
        "executiveInsights": _validar_hallazgos,
        "executiveAssessment": _validar_evaluacion,
        "recommendationEnrichment": lambda r: _validar_enriquecimiento(r, recomendaciones),
    }
    respaldos = {
        "executiveSummary": deterministas.get("executiveSummary") or executive_summary(ctx),
        "executiveInsights": deterministas.get("executiveInsights") or executive_insights(ctx),
        "executiveAssessment": deterministas.get("executiveAssessment")
        or executive_assessment(ctx),
        "recommendationEnrichment": deterministas.get("recommendationEnrichment")
        or recommendation_enrichment(recomendaciones),
    }

    nova = dict(deterministas)
    sin_ia = []
    aviso = None
    for seccion, resultado in zip(SECCIONES, resultados, strict=True):
        validado = validadores[seccion](resultado.datos) if resultado.con_ia else None
        if validado is None:
            sin_ia.append(seccion)
            nova[seccion] = respaldos[seccion]
            aviso = aviso or resultado.mensaje or nucleo.MENSAJES[nucleo.R.FALLO]
        else:
            nova[seccion] = validado
    nova.setdefault("scenarios", None)

    doc["nova"] = nova
    doc["novaSeccionesSinIa"] = sin_ia
    doc["novaOrigen"] = NOVA_IA if len(sin_ia) < len(SECCIONES) else NOVA_DETERMINISTA
    doc["novaDegraded"] = bool(sin_ia) and cliente.configurada()
    doc["novaAviso"] = aviso
    meta = doc.get("meta") or {}
    if "generationMs" in meta:
        meta["generationMs"] += int((time.monotonic() - comenzo) * 1000)
    return doc
