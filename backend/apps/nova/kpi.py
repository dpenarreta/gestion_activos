"""«Análisis de Nova» en los KPI de una persona (Nexo:
`src/app/api/kpis/nova-insights/[userId]/route.ts`).

Nova no calcula nada: recibe lo que ya calculó el motor de KPI
(`apps.analytics.pipeline.run_analytics_pipeline` y, con permiso, el Riesgo
Operativo) y lo explica en lenguaje natural.

**Variantes** (en Nexo salían del nivel del rol; aquí, de los permisos del KPI
y del organigrama, que ya decidió que quien consulta puede ver a la persona):

- `completo` (Nexo: nivel >= 3, Administrador/Jefe/Coordinador Nacional):
  quien tiene `kpi.ejecutivo` o `kpi.administrar`, sobre sí o sobre alguien de
  su equipo. Hallazgo principal, riesgos, aspectos positivos y recomendaciones.
- `solo_hallazgos` (Nexo: nivel 2, analistas que ven al equipo): quien tiene
  `kpi.equipo` pero no lo anterior, sea sobre sí o sobre alguien que el
  organigrama le deja ver (su cargo depende del suyo, `Cargo.jefe`). Solo el
  hallazgo principal y los aspectos positivos.
- `motivacional` (Nexo: nivel 1 viéndose a sí mismo): la persona sin equipo a
  cargo que mira sus propios KPI. Dos o tres frases cercanas.

El Riesgo Operativo entra solo si quien consulta tiene
`inteligencia_preventiva.ver` (como `canViewOperationalRisk`).

**Diferencia con Nexo (privacidad):** Nexo mandaba el estado especial
(maternidad/lactancia) al propio titular y al administrador. Aquí no se manda
nunca: ningún dato de salud sale hacia Google. La persona va como «Persona A»
con su cargo; su nombre se repone al mostrar el texto.

Caché por consultante + persona + variante + riesgo (`NOVA_CACHE_MINUTOS`):
con el consultante en la clave, el primer acceso de cada quien siempre pasa
por la autorización (hallazgo de seguridad de Nexo del 02/09/2026).
"""

from django.utils import timezone

from apps.analytics import access as kpi_access
from apps.tasks import jerarquia

from . import nucleo
from .seudonimos import Seudonimizador

FUNCION = "kpi"

COMPLETO = "completo"
SOLO_HALLAZGOS = "solo_hallazgos"
MOTIVACIONAL = "motivacional"

SISTEMA_ANALITICO = (
    "Eres Nova, analista de People Analytics de la intranet. Recibirás un JSON con datos YA "
    "CALCULADOS por un motor determinístico (nunca los calcules tú, ni los cuestiones ni los "
    "recalcules). Tu única función es explicar esos datos en lenguaje natural, en español y "
    "tratando de usted, e identificar los puntos más importantes. NUNCA inventes datos que no "
    "estén en el JSON. NUNCA suavices resultados negativos: sé directo y objetivo. La persona "
    "aparece con un seudónimo («Persona A»): refiérete a ella exactamente así. Responde "
    "EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown, con esta forma "
    'exacta: {"hallazgoPrincipal": string, "riesgos": string[], "aspectosPositivos": string[], '
    '"recomendaciones": string[]}, con este criterio por campo: '
    "hallazgoPrincipal = el dato más importante del período, con al menos un número. "
    "riesgos = entre 1 y 3 riesgos con datos específicos; si no hay, un único ítem que lo diga "
    "(nunca un arreglo vacío). "
    "aspectosPositivos = entre 1 y 2 aspectos positivos con números; si no hay, un único ítem "
    "que lo diga (nunca un arreglo vacío). "
    "recomendaciones = entre 1 y 2 acciones concretas y priorizadas, con plazo (qué hacer, "
    "cuándo), nunca genéricas."
)

SISTEMA_MOTIVACIONAL = (
    "Eres Nova, la asistente de People Analytics de la intranet. Recibirás un JSON con datos YA "
    "CALCULADOS (nunca los calcules ni los inventes) sobre el desempeño de una persona, que es "
    "quien va a leer el mensaje. Genera un mensaje breve, cercano y motivador sobre su propio "
    "desempeño, en tono cálido y de apoyo, en español simple, tratando de usted, sin tecnicismos "
    "de recursos humanos y sin mencionar su seudónimo. Si hay algo que mejorar, menciónalo con "
    "delicadeza y de forma constructiva, nunca alarmante. Responde EXCLUSIVAMENTE con un objeto "
    'JSON válido, sin texto adicional ni markdown, con esta forma exacta: {"messages": string[]}, '
    "con entre 2 y 3 mensajes cortos (una frase natural cada uno, sin viñetas)."
)


def _arreglo_de_textos() -> dict:
    return {"type": "array", "items": {"type": "string"}}


ESQUEMA_ANALITICO = {
    "type": "object",
    "properties": {
        "hallazgoPrincipal": {"type": "string"},
        "riesgos": _arreglo_de_textos(),
        "aspectosPositivos": _arreglo_de_textos(),
        "recomendaciones": _arreglo_de_textos(),
    },
    "required": ["hallazgoPrincipal", "riesgos", "aspectosPositivos", "recomendaciones"],
    "additionalProperties": False,
}

ESQUEMA_MOTIVACIONAL = {
    "type": "object",
    "properties": {"messages": _arreglo_de_textos()},
    "required": ["messages"],
    "additionalProperties": False,
}


def variante(actor, target) -> str:
    """Qué análisis recibe `actor` sobre `target` (ya autorizado a verlo)."""
    liderazgo = kpi_access.can(actor, kpi_access.EJECUTIVO) or kpi_access.is_admin(actor)
    if liderazgo:
        return COMPLETO
    if kpi_access.can(actor, kpi_access.EQUIPO):
        return SOLO_HALLAZGOS
    # Sin equipo a cargo solo puede estar viéndose a sí mismo (`can_view_target`).
    return MOTIVACIONAL


def _nombre(user) -> str:
    return (user.get_full_name() or user.first_name or user.username or "").strip()


def _cargo(user) -> str | None:
    cargo = jerarquia.cargo_de(user)
    return cargo.nombre if cargo is not None else None


def _cumplimiento_pct(health: dict) -> int:
    factor = next((f for f in health.get("factors") or [] if f.get("name") == "Cumplimiento"), None)
    try:
        return int(float(str((factor or {}).get("raw_label", "0")).rstrip("%")))
    except ValueError:
        return 0


# ── Respaldos sin IA (como Nexo: siempre desde datos ya calculados) ─────────


def _respaldo_analitico(health: dict, alertas: list, tendencias: dict, riesgo: dict | None):
    cumplimiento = next(
        (
            f.get("raw_label")
            for f in health.get("factors") or []
            if f.get("name") == "Cumplimiento"
        ),
        "—",
    )
    positivos = []
    if health.get("classification") in ("Excelente", "Bueno"):
        positivos.append(
            f"Equilibrio Operativo: {health.get('score')}/100 ({health.get('classification')})."
        )
    mes_anterior = ((tendencias or {}).get("cumplimiento") or {}).get("mes_anterior") or {}
    if mes_anterior.get("available") and mes_anterior.get("direction") == "mejora":
        positivos.append(
            f"El cumplimiento mejoró {mes_anterior.get('absolute_diff')} pp frente al mes anterior."
        )
    riesgos = [a["message"] for a in alertas if a.get("severity") in ("red", "orange")]
    recomendaciones = list((riesgo or {}).get("suggested_actions") or [])
    return {
        "hallazgoPrincipal": (
            f"Equilibrio Operativo: {health.get('score')}/100 ({health.get('classification')}), "
            f"cumplimiento del {cumplimiento}."
        ),
        "riesgos": riesgos or ["Sin riesgos detectados en este período."],
        "aspectosPositivos": positivos or ["Sin aspectos destacables este período."],
        "recomendaciones": recomendaciones
        or ["Sin acciones urgentes: mantener el seguimiento habitual."],
    }


def _respaldo_motivacional(pct: int) -> list[str]:
    if pct >= 80:
        return [
            f"¡Excelente mes! Cumplió el {pct}% de sus tareas.",
            "Siga así: su ritmo de trabajo está muy bien encaminado.",
        ]
    if pct >= 60:
        return [
            f"Va bien: {pct}% de cumplimiento este período.",
            "Con un poco más de foco en las tareas pendientes puede subir aún más.",
        ]
    return [
        f"Este período su cumplimiento fue {pct}%.",
        "No se desanime: revise sus tareas pendientes y priorice con su jefe si necesita apoyo.",
    ]


def _textos(valor) -> list[str]:
    if not isinstance(valor, list):
        return []
    return [v.strip() for v in valor if isinstance(v, str) and v.strip()]


def _guardar(clave: str, respuesta: dict) -> None:
    # Solo lo que generó la IA: la versión sin IA se recalcula en cada pedido,
    # así que al reponerse la IA (o al día siguiente del límite) se vuelve a
    # intentar sin esperar a que venza la caché.
    if respuesta["con_ia"]:
        nucleo.guardar_cache(clave, respuesta)


# ── La función ───────────────────────────────────────────────────────────────


def analizar(actor, target) -> dict:
    """El análisis de Nova de `target` para `actor`. `target` ya está
    autorizado (empresa activa y ámbito del organigrama)."""
    tipo = variante(actor, target)
    con_riesgo = tipo != MOTIVACIONAL and kpi_access.can(actor, kpi_access.RIESGO_VER)
    clave = nucleo.clave_cache(
        FUNCION, actor.pk, target.pk, tipo, "riesgo" if con_riesgo else "sin_riesgo"
    )
    guardado = nucleo.leer_cache(clave)
    if guardado is not None:
        return guardado

    from apps.analytics.operational_risk import compute_operational_risk
    from apps.analytics.pipeline import run_analytics_pipeline

    now = timezone.now()
    bundle = run_analytics_pipeline(user=target, now=now)
    health = bundle["health_score"]
    seud = Seudonimizador()
    alias = seud.persona(
        _nombre(target), target.username, target.last_name, target.email, clave=target.pk
    )

    if tipo == MOTIVACIONAL:
        pct = _cumplimiento_pct(health)
        pedido = nucleo.Pedido(
            sistema=SISTEMA_MOTIVACIONAL,
            datos={
                "persona": alias,
                "equilibrioOperativo": {
                    "valor": health.get("score"),
                    "clasificacion": health.get("classification"),
                },
                "cumplimientoPct": pct,
            },
            esquema=ESQUEMA_MOTIVACIONAL,
            max_tokens=4096,
            temperatura=0.6,
            esfuerzo="low",
        )
        resultado = nucleo.generar(actor, FUNCION, pedido, seud)
        mensajes = _textos((resultado.datos or {}).get("messages")) if resultado.con_ia else []
        respuesta = {
            "variante": tipo,
            "con_ia": bool(mensajes),
            "motivo": None if mensajes else (resultado.motivo or nucleo.R.FALLO),
            "mensaje": None if mensajes else (resultado.mensaje or nucleo.MENSAJES[nucleo.R.FALLO]),
            "mensajes": mensajes or _respaldo_motivacional(pct),
            "generado_en": now.isoformat(),
        }
        _guardar(clave, respuesta)
        return respuesta

    riesgo = compute_operational_risk(user=target, now=now) if con_riesgo else None
    tendencias = bundle.get("trends") or {}
    alertas = bundle.get("alerts") or []
    datos = {
        "persona": alias,
        "cargo": _cargo(target),
        "equilibrioOperativo": {
            "valor": health.get("score"),
            "clasificacion": health.get("classification"),
            "factores": [
                {"nombre": f.get("name"), "detalle": f.get("detail")}
                for f in health.get("factors") or []
            ],
        },
        "alertasActivas": [
            {"severidad": a.get("severity"), "mensaje": a.get("message")} for a in alertas
        ],
        "tendencias": {
            "cumplimientoVsMesAnterior": (tendencias.get("cumplimiento") or {}).get("mes_anterior"),
            "cumplimientoVsPromedio6Meses": (tendencias.get("cumplimiento") or {}).get(
                "promedio_6_meses"
            ),
            "cargaVsMesAnterior": (tendencias.get("carga") or {}).get("mes_anterior"),
        },
        "consistencia": bundle.get("consistency"),
        "anomaliasDetectadas": bundle.get("anomalies"),
        "prediccion": bundle.get("prediction"),
        "calidadDeLosDatos": bundle.get("data_quality"),
    }
    if riesgo is not None:
        datos["riesgoOperativo"] = {
            "valor": riesgo.get("score"),
            "clasificacion": riesgo.get("classification"),
            "tendenciaVsMesAnterior": riesgo.get("trend_vs_prev_month"),
            "factoresConImpacto": [
                f.get("detail") for f in riesgo.get("factors") or [] if (f.get("points") or 0) > 0
            ],
        }

    resultado = nucleo.generar(
        actor,
        FUNCION,
        nucleo.Pedido(
            sistema=SISTEMA_ANALITICO,
            datos=datos,
            esquema=ESQUEMA_ANALITICO,
            max_tokens=8192,
            temperatura=0.4,
            esfuerzo="medium",
        ),
        seud,
    )
    respaldo = _respaldo_analitico(health, alertas, tendencias, riesgo)
    ia = resultado.datos if resultado.con_ia and isinstance(resultado.datos, dict) else {}
    hallazgo = ia.get("hallazgoPrincipal") if isinstance(ia.get("hallazgoPrincipal"), str) else ""
    riesgos = _textos(ia.get("riesgos"))
    positivos = _textos(ia.get("aspectosPositivos"))
    recomendaciones = _textos(ia.get("recomendaciones"))
    # Como Nexo: sin hallazgo, riesgos o positivos, la respuesta no sirve.
    con_ia = bool(hallazgo.strip() and riesgos and positivos)
    if not con_ia:
        hallazgo, riesgos, positivos, recomendaciones = (
            respaldo["hallazgoPrincipal"],
            respaldo["riesgos"],
            respaldo["aspectosPositivos"],
            respaldo["recomendaciones"],
        )
    elif not recomendaciones:
        recomendaciones = respaldo["recomendaciones"]

    respuesta = {
        "variante": tipo,
        "con_ia": con_ia,
        "motivo": None if con_ia else (resultado.motivo or nucleo.R.FALLO),
        "mensaje": None if con_ia else (resultado.mensaje or nucleo.MENSAJES[nucleo.R.FALLO]),
        "hallazgo_principal": hallazgo.strip(),
        "aspectos_positivos": positivos,
        "generado_en": now.isoformat(),
    }
    if tipo == COMPLETO:
        respuesta["riesgos"] = riesgos
        respuesta["recomendaciones"] = recomendaciones
    _guardar(clave, respuesta)
    return respuesta
