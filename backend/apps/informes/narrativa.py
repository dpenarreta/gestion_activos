"""Estado General, Índice Ejecutivo y la narrativa determinista del informe.

Portado de `src/lib/executiveReporting/` de Nexo: `indiceEjecutivo.ts`,
`estadoGeneral.ts`, `context.ts` y `nova/fallbacks.ts`. Todo trabaja sobre el
documento ya construido (en camelCase, la forma de `ExecutiveReportSnapshotData`)
y es puro: no consulta la base ni recalcula indicadores.

Estos textos son la narrativa SIN IA, con la misma forma (`NovaSections`) que
la de la IA. Desde el 09/11/2026 `apps.nova.informes.narrar` los reemplaza por
los de Nova (sección por sección) cuando quien genera tiene
`nova.narrativa_informes` y la IA responde; si no, quedan estos, y el documento
lo dice en `novaOrigen`/`novaSeccionesSinIa`.
"""

from apps.tasks.rounding import round_half_up

#: Marca del documento: de dónde salió la narrativa de `nova`.
NOVA_DETERMINISTA = "DETERMINISTA"

SIN_DATOS = "Sin datos para el período"


# ── Índice Ejecutivo (`indiceEjecutivo.ts`) ─────────────────────────────────


def classify_indice_ejecutivo(avg_performance: float, avg_equilibrio: float) -> dict:
    """Promedio de Performance Score y Equilibrio Operativo, en cuatro bandas
    (85/70/50). Solo tiene sentido en el mes en curso: el Equilibrio incluye la
    Capacidad Futura, una proyección hacia adelante."""
    valor = round_half_up(((avg_performance + avg_equilibrio) / 2) * 10) / 10
    if valor >= 85:
        return {
            "valor": valor,
            "nivel": "Excelente",
            "color": "green",
            "explicacion": "El equipo mantiene un desempeño y equilibrio operativo sobresalientes. Puede asumir nuevos proyectos sin riesgo.",
        }
    if valor >= 70:
        return {
            "valor": valor,
            "nivel": "Bueno",
            "color": "green",
            "explicacion": "El equipo opera de forma saludable, con desempeño y equilibrio dentro de rangos aceptables.",
        }
    if valor >= 50:
        return {
            "valor": valor,
            "nivel": "Atención",
            "color": "yellow",
            "explicacion": "El equipo muestra señales que conviene atender antes de que se conviertan en un problema operativo mayor.",
        }
    return {
        "valor": valor,
        "nivel": "Crítico",
        "color": "red",
        "explicacion": "El equipo requiere intervención inmediata — el desempeño y/o el equilibrio operativo están comprometidos.",
    }


# ── Estado General (`estadoGeneral.ts`) ─────────────────────────────────────


def _vacio(doc: dict) -> bool:
    """El único criterio de «informe vacío»: sin colaboradores, sin tareas y
    sin consultas."""
    members = doc.get("members") or []
    resumen = doc.get("teamSummary") or {}
    return (
        not members
        and (resumen.get("totalTasks") or 0) == 0
        and (resumen.get("totalConsultas") or 0) == 0
    )


def resolve_estado_general(doc: dict) -> dict:
    """El Estado General de la portada. Con Índice Ejecutivo (mes en curso), el
    índice tal cual; sin él, una aproximación con el cumplimiento y la
    cercanía de la carga al 100% (mismas bandas y etiquetas), que lo dice en
    su explicación. «Sin datos» solo si el informe está vacío. Defensivo: un
    informe migrado incompleto no revienta."""
    resumen = doc.get("teamSummary")
    if _vacio(doc) or not resumen:
        return {
            "nivel": SIN_DATOS,
            "color": "gray",
            "valor": None,
            "explicacion": None,
            "fromIndiceEjecutivo": False,
        }
    indice = (doc.get("estadoGeneral") or {}).get("indiceEjecutivo")
    if indice:
        return {
            "nivel": indice["nivel"],
            "color": indice["color"],
            "valor": indice["valor"],
            "explicacion": indice["explicacion"],
            "fromIndiceEjecutivo": True,
        }
    carga_score = max(0, 100 - abs((resumen.get("avgCargaPct") or 0) - 100))
    clasificado = classify_indice_ejecutivo(resumen.get("avgCumplimiento") or 0, carga_score)
    return {
        "nivel": clasificado["nivel"],
        "color": clasificado["color"],
        "valor": clasificado["valor"],
        "explicacion": (
            f"{clasificado['explicacion']} (aproximación basada en Cumplimiento y Carga Laboral "
            "del equipo — el Índice Ejecutivo completo, que incorpora Equilibrio Operativo y "
            "Capacidad Futura, solo aplica al mes calendario en curso)."
        ),
        "fromIndiceEjecutivo": False,
    }


# ── Contexto condensado (`context.ts`) ──────────────────────────────────────


def _destacado(m: dict) -> dict:
    return {
        "id": m["id"],
        "name": m["name"],
        "role": m["role"],
        "score": m["score"],
        "completedPct": m["completedPct"],
    }


def derive_context(doc: dict) -> dict:
    """La vista condensada del documento sobre la que se redacta la narrativa
    (en Nexo, la que recibía NOVA). No agrega datos: reordena los que hay."""
    por_score = sorted(doc["members"], key=lambda m: -m["score"])
    estado = resolve_estado_general(doc)
    resumen = doc["teamSummary"]
    return {
        "meta": {
            "type": doc["meta"]["type"],
            "periodLabel": doc["meta"]["periodLabel"],
            "fechaCorte": doc["meta"]["fechaCorte"],
            "periodStatus": doc["meta"]["periodStatus"],
            "collaboratorCount": doc["meta"]["collaboratorCount"],
        },
        "resumen": {
            "avgCumplimiento": resumen["avgCumplimiento"],
            "avgCargaPct": resumen["avgCargaPct"],
            "totalConsultas": resumen["totalConsultas"],
            "totalTasks": resumen["totalTasks"],
            "totalCompletedTasks": resumen["totalCompletedTasks"],
            "estadoGeneralNivel": None if estado["nivel"] == SIN_DATOS else estado["nivel"],
            "estadoGeneralValor": estado["valor"],
            "dataQualityPct": doc["estadoGeneral"]["dataQuality"]["pct"],
        },
        "tendenciaMensual": doc.get("trends"),
        "tendenciaRango": doc.get("rangeTrend"),
        "hallazgos": [f["text"] for f in doc["findings"]],
        "insights": doc["insights"],
        "alertas": doc["alerts"],
        "distribucionTop": doc["distribuciones"]["consultasByReason"][:3],
        "recomendaciones": doc["recommendations"],
        "destacado": {
            "mejor": _destacado(por_score[0]) if por_score else None,
            "atencion": _destacado(por_score[-1]) if len(por_score) > 1 else None,
        },
    }


# ── Narrativa determinista (`nova/fallbacks.ts`) ────────────────────────────


def executive_summary(ctx: dict) -> dict:
    r = ctx["resumen"]
    nivel = r["estadoGeneralNivel"]
    situacion = (
        f'El equipo cierra el período en un nivel general "{nivel}", con un cumplimiento '
        f"promedio de {r['avgCumplimiento']}% y una carga laboral del {r['avgCargaPct']}%."
        if nivel
        else f"El equipo registra un cumplimiento promedio de {r['avgCumplimiento']}% y una "
        f"carga laboral del {r['avgCargaPct']}% en el período evaluado."
    )
    mejor = ctx["destacado"]["mejor"]
    fortalezas = (
        f"{mejor['name']} lidera el desempeño del equipo con {mejor['completedPct']}% de cumplimiento."
        if mejor and mejor["completedPct"] >= 80
        else "No se identifican fortalezas destacables respaldadas por los datos de este período."
    )
    alertas = ctx["alertas"]
    if alertas:
        primera = alertas[0]
        tipo = "cumplimiento" if primera["type"] == "cumplimiento" else "carga laboral"
        atencion = (
            f"Se registran {len(alertas)} alerta(s) activa(s), incluyendo a {primera['name']} "
            f"({tipo}: {primera['value']}%)."
        )
    else:
        atencion = (
            "No se registran alertas activas de cumplimiento o carga laboral en este período."
        )
    recomendaciones = ctx["recomendaciones"]
    conclusion = (
        f"Se identifican {len(recomendaciones)} recomendación(es) accionable(s) para el próximo "
        "período (ver sección de Recomendaciones)."
        if recomendaciones
        else "Los indicadores del equipo se mantienen dentro de rangos esperables; se sugiere "
        "mantener el seguimiento habitual."
    )
    return {
        "situacionGeneral": situacion,
        "fortalezas": fortalezas,
        "aspectosAtencion": atencion,
        "conclusion": conclusion,
    }


def executive_insights(ctx: dict) -> dict:
    r = ctx["resumen"]
    top = ctx["distribucionTop"]
    patrones = (
        [
            f"El motivo de consulta más frecuente concentra {top[0].get('pct') or 0}% del total registrado."
        ]
        if top
        else [
            "Sin distribución de consultas suficiente para identificar un patrón en este período."
        ]
    )

    mensual = (ctx.get("tendenciaMensual") or {}).get("mesAnterior")
    rango = ctx.get("tendenciaRango")
    if mensual and mensual["direction"] != "sin-datos":
        verbo = {"mejora": "mejoró", "deterioro": "empeoró"}.get(
            mensual["direction"], "se mantuvo estable"
        )
        cambios = [
            f"El cumplimiento del equipo {verbo} respecto al mes anterior "
            f"({mensual['compareValue']}% → {mensual['currentValue']}%)."
        ]
    elif rango:
        cambios = [
            f'La tendencia del rango es "{rango["cumplimientoTrend"]}" '
            f"({rango['firstMonthAvgCumplimiento']}% → {rango['lastMonthAvgCumplimiento']}%)."
        ]
    else:
        cambios = [
            "La evidencia disponible no permite determinar una tendencia comparable en este período."
        ]

    if r["avgCumplimiento"] >= 80 and r["avgCargaPct"] >= 100:
        relaciones = [
            "El cumplimiento alto combinado con una carga laboral elevada sugiere un riesgo de "
            "sostenibilidad del ritmo actual."
        ]
    elif r["avgCumplimiento"] < 60 and r["avgCargaPct"] < 80:
        relaciones = [
            "El cumplimiento bajo combinado con una carga laboral reducida sugiere un posible "
            "problema de productividad, no de capacidad."
        ]
    else:
        relaciones = [
            "La evidencia disponible no permite establecer una relación cruzada concluyente entre "
            "cumplimiento y carga laboral en este período."
        ]
    return {
        "patrones": patrones,
        "cambios": cambios,
        "anomalias": [
            "La evidencia disponible a nivel de equipo no permite determinar anomalías puntuales "
            "en este período."
        ],
        "relacionesCruzadas": relaciones,
    }


def executive_assessment(ctx: dict) -> dict:
    r = ctx["resumen"]
    nivel = r["estadoGeneralNivel"]
    diagnostico = (
        f'El estado general del equipo se clasifica como "{nivel}", con un cumplimiento '
        f"promedio de {r['avgCumplimiento']}% y una calidad de datos del {r['dataQualityPct']}%."
        if nivel
        else f"El equipo registra un cumplimiento promedio de {r['avgCumplimiento']}% en el "
        f"período evaluado, con una calidad de datos del {r['dataQualityPct']}%."
    )
    mejor = ctx["destacado"]["mejor"]
    fortalezas = (
        [f"{mejor['name']} sostiene el mayor cumplimiento del equipo ({mejor['completedPct']}%)."]
        if mejor
        else [
            "No se identifican fortalezas estratégicas respaldadas por los datos de este período."
        ]
    )
    riesgos = [
        (
            f"{a['name']}: cumplimiento de {a['value']}%, por debajo del umbral operativo."
            if a["type"] == "cumplimiento"
            else f"{a['name']}: carga laboral de {a['value']}%, por encima del rango óptimo."
        )
        for a in ctx["alertas"][:3]
    ] or ["No se detectan riesgos activos respaldados por los datos de este período."]
    altas = [rec["text"] for rec in ctx["recomendaciones"] if rec["priority"] == "alta"]
    desempeno = "adecuado" if r["avgCumplimiento"] >= 70 else "que requiere atención"
    atencion = ctx["destacado"]["atencion"]
    opinion = (
        f"La operación mantiene un desempeño {desempeno}; {atencion['name']} representa el caso "
        "que más beneficio obtendría de una intervención priorizada en el próximo período."
        if atencion
        else f"La operación mantiene un desempeño {desempeno} en el período evaluado."
    )
    return {
        "diagnosticoGeneral": diagnostico,
        "fortalezasEstrategicas": fortalezas,
        "riesgosDetectados": riesgos,
        "oportunidades": [
            "La evidencia disponible no permite cuantificar una oportunidad de retorno "
            "específico en este período."
        ],
        "prioridades": altas or ["Mantener el seguimiento habitual de los indicadores del equipo."],
        "perspectivaEstrategica": (
            "La evidencia disponible respalda un seguimiento continuo de los indicadores "
            "actuales; una proyección más amplia requiere datos adicionales de períodos futuros."
        ),
        "opinionEjecutiva": opinion,
    }


_IMPACTO = {
    "alta": "Reduce un riesgo operativo de corto plazo si se ejecuta en el próximo período.",
    "media": "Contribuye a una mejora gradual del indicador asociado.",
}
_PLAZO = {
    "alta": "Inmediato — próximos 7 días.",
    "media": "Mediano plazo — próximas 2 a 4 semanas.",
}
_COMPLEJIDAD = {
    "alta": "Media — requiere coordinar la redistribución con las personas involucradas.",
    "media": "Baja — ajuste dentro de la operación habitual del equipo.",
}


def recommendation_enrichment(recomendaciones: list[dict]) -> list[dict]:
    """Una anotación por recomendación, 1:1 por `id`: nunca agrega ni quita."""
    return [
        {
            "id": rec["id"],
            "justificacion": rec["text"],
            "impactoEsperado": _IMPACTO[rec["priority"]],
            "areaAfectada": "Operación del equipo.",
            "beneficio": (
                "Mitiga un riesgo operativo identificado."
                if rec["priority"] == "alta"
                else "Sostiene la mejora continua del equipo."
            ),
            "complejidadEstimada": _COMPLEJIDAD[rec["priority"]],
            "tiempoEstimado": _PLAZO[rec["priority"]],
            "responsableSugerido": "Coordinación del equipo.",
        }
        for rec in recomendaciones
    ]


def narrativa_determinista(doc: dict) -> dict:
    """Las secciones de `nova` (`NovaSections`) a partir del documento.
    `scenarios` queda en None, como en Nexo: los escenarios de equipo no
    existen todavía."""
    ctx = derive_context(doc)
    return {
        "executiveSummary": executive_summary(ctx),
        "executiveInsights": executive_insights(ctx),
        "executiveAssessment": executive_assessment(ctx),
        "recommendationEnrichment": recommendation_enrichment(ctx["recomendaciones"]),
        "scenarios": None,
    }
