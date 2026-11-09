"""Las once páginas del informe, en su orden fijo (`documentModel.ts` de Nexo).

Portada → Executive Summary → Estado General del Equipo → Indicadores
Estratégicos → Detalle por Colaborador → Distribución Operativa → Executive
Insights → Executive Assessment → Recomendaciones → Analytics Predictivo →
Metadatos.

`construir_paginas` es pura: lee un documento ya congelado y no consulta nada.
La consumen el detalle del informe (para la vista imprimible del frontend, que
hace el PDF) y la exportación a Excel, así que los dos formatos nunca difieren
en orden ni en contenido. Las páginas van en camelCase, como en Nexo.

Las fechas se escriben en la hora de la intranet (America/Guayaquil): en Nexo
dependían de la zona del navegador o del servidor que renderizaba. Las que son
«solo fecha» (el `cutoffDate` de un cierre, medianoche UTC) se leen en UTC para
no correr el día.

Defensivo como en Nexo: un informe migrado incompleto (sin `meta`, sin
`teamSummary`…) produce marcadores visibles («—», «No disponible.») en vez de
fallar.
"""

from datetime import UTC, datetime

from django.utils import timezone

from .narrativa import SIN_DATOS, resolve_estado_general

_MESES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]
_MESES_CORTOS = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sept",
    "oct",
    "nov",
    "dic",
]

TIPO_REPORTE_LABEL = {
    "MENSUAL": "Informe Mensual",
    "RANGO_MESES": "Informe de Rango (meses)",
    "RANGO_PERSONALIZADO": "Informe de Rango Personalizado",
}
PERIOD_STATUS_LABEL = {"EN_CURSO": "En curso", "CERRADO": "Cerrado", "HISTORICO": "Histórico"}
ROSTER_KIND_LABEL = {
    "CONSOLIDADO": "Equipo consolidado",
    "POR_AREA": "Por área/rol",
    "INDIVIDUAL": "Individual",
}
CLOSURE_STATUS_LABEL = {
    "EARLY": "Cerrado anticipadamente",
    "MANUAL": "Cerrado — fecha de corte regularizada manualmente",
}
QUADRANT_LABEL = {
    "criticos": "Crítico",
    "atencion-carga": "Atención (carga)",
    "atencion-cumplimiento": "Atención (cumplimiento)",
    "saludables": "Saludable",
}

NO_DISPONIBLE = "No disponible."
GUION = "—"

MENSAJE_SIN_PREDICCION = (
    "Analytics Predictivo solo proyecta hacia adelante para el mes calendario en curso — este "
    "reporte corresponde a un período distinto (o de rango), así que no aplica. Los 3 "
    "escenarios de equipo (Esperado/Preventivo/Optimista) quedan además pendientes de una fase "
    "posterior: el motor de predicción existente es por colaborador, todavía no hay una "
    "síntesis a nivel de equipo."
)


def _instante(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        valor = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return valor if valor.tzinfo else valor.replace(tzinfo=UTC)


def fecha_larga(iso: str | None) -> str:
    """«06 de noviembre de 2026», en la hora de la intranet."""
    valor = _instante(iso)
    if valor is None:
        return GUION
    local = timezone.localtime(valor)
    return f"{local.day:02d} de {_MESES[local.month - 1]} de {local.year}"


def fecha_larga_utc(iso: str | None) -> str:
    """Igual, para valores «solo fecha» (medianoche UTC)."""
    valor = _instante(iso)
    if valor is None:
        return GUION
    valor = valor.astimezone(UTC)
    return f"{valor.day:02d} de {_MESES[valor.month - 1]} de {valor.year}"


def fecha_hora(iso: str | None) -> str:
    """«06/11/2026 14:30», en la hora de la intranet."""
    valor = _instante(iso)
    if valor is None:
        return GUION
    return timezone.localtime(valor).strftime("%d/%m/%Y %H:%M")


def _dia_mes_utc(iso: str | None) -> str:
    """«1 jul», en UTC (valores «solo fecha»)."""
    valor = _instante(iso)
    if valor is None:
        return GUION
    valor = valor.astimezone(UTC)
    return f"{valor.day} {_MESES_CORTOS[valor.month - 1]}"


def _cierre_visible(meta: dict) -> dict | None:
    closure = meta.get("closure")
    if closure and closure.get("closureType") in CLOSURE_STATUS_LABEL:
        return closure
    return None


def nota_metodologica(closure: dict) -> str | None:
    """El párrafo del cierre anticipado o regularizado (portada y metadatos)."""
    tipo = closure.get("closureType")
    if tipo not in CLOSURE_STATUS_LABEL:
        return None
    cerrado = fecha_larga(closure.get("closedAt"))
    corte = fecha_larga_utc(closure.get("cutoffDate"))
    dias = closure.get("workingDaysConsidered")
    horas = closure.get("workingHoursConsidered")
    if tipo == "EARLY":
        return (
            f"Este informe corresponde a un cierre anticipado realizado el {cerrado}, antes de "
            "finalizar el período. Todos los indicadores, KPIs y análisis fueron calculados "
            "utilizando exclusivamente la información registrada hasta esa fecha, considerando "
            f"{dias} días hábiles y {horas} horas base. Los registros posteriores al cierre no "
            "forman parte del presente análisis."
        )
    return (
        "Este informe corresponde a un período cuya fecha de corte fue regularizada "
        f"manualmente. El cierre se ejecutó el {cerrado}, pero toda la información fue "
        f"calculada utilizando exclusivamente lo registrado hasta el {corte} (por motivos "
        "operativos, de auditoría o de regularización de datos), considerando "
        f"{dias} días hábiles y {horas} horas base. Los registros posteriores a la fecha de "
        "corte no forman parte del presente análisis."
    )


def _portada(doc: dict) -> dict:
    estado = resolve_estado_general(doc)
    meta = doc.get("meta") or {}
    versiones = meta.get("versions") or {}
    closure = _cierre_visible(meta)
    return {
        "kind": "cover",
        "reportId": meta.get("reportId") or GUION,
        "tipoReporteLabel": TIPO_REPORTE_LABEL.get(meta.get("type"), "Informe Ejecutivo"),
        "periodLabel": meta.get("periodLabel") or "Período no disponible",
        "fechaCorteLabel": fecha_larga(meta.get("fechaCorte")),
        "generatedAtLabel": fecha_hora(meta.get("generatedAt")),
        "generatedByName": (meta.get("generatedBy") or {}).get("name") or GUION,
        "estadoGeneralLabel": estado["nivel"],
        "estadoGeneralColor": estado["color"],
        "scoreGeneral": estado["valor"],
        "semaforoLabel": estado["explicacion"],
        "analyticsEngineVersion": versiones.get("analyticsEngineVersion") or GUION,
        "formulaSetVersion": versiones.get("formulaSetVersion") or GUION,
        "closureStatusLabel": CLOSURE_STATUS_LABEL[closure["closureType"]] if closure else None,
        "coverageLabel": (
            f"{_dia_mes_utc(meta.get('periodStart'))} – {_dia_mes_utc(closure.get('cutoffDate'))}"
            if closure and meta.get("periodStart")
            else None
        ),
        "workingDaysConsideredLabel": (
            f"{closure['workingDaysConsidered']} días hábiles" if closure else None
        ),
        "workingHoursConsideredLabel": (
            f"{closure['workingHoursConsidered']} horas" if closure else None
        ),
        "metodologicalNoteLabel": nota_metodologica(closure) if closure else None,
    }


def _con_ia(doc: dict, seccion: str) -> bool:
    """Si el texto de `seccion` lo redactó la IA (Nova): el informe es de
    origen NOVA y la sección no quedó entre las de respaldo."""
    return doc.get("novaOrigen") == "NOVA" and seccion not in (doc.get("novaSeccionesSinIa") or [])


def _resumen_ejecutivo(doc: dict) -> dict:
    s = (doc.get("nova") or {}).get("executiveSummary") or {}
    return {
        "kind": "executiveSummary",
        "conIa": _con_ia(doc, "executiveSummary"),
        "situacionGeneral": s.get("situacionGeneral") or NO_DISPONIBLE,
        "fortalezas": s.get("fortalezas") or NO_DISPONIBLE,
        "aspectosAtencion": s.get("aspectosAtencion") or NO_DISPONIBLE,
        "conclusion": s.get("conclusion") or NO_DISPONIBLE,
    }


def _indicador(nombre, valor, meta, estado, explicacion: dict | None) -> dict:
    explicacion = explicacion or {}
    return {
        "nombre": nombre,
        "valor": valor,
        "meta": meta,
        "estado": estado,
        "interpretacion": explicacion.get("meaning") or "",
        "impacto": explicacion.get("impact") or "",
        "recomendacion": explicacion.get("action") or "",
    }


def _estado_del_equipo(doc: dict) -> dict:
    resumen = doc.get("teamSummary") or {}
    explicaciones = doc.get("indicatorExplanations") or {}
    cumplimiento = resumen.get("avgCumplimiento", 0)
    carga = resumen.get("avgCargaPct", 0)
    indicadores = [
        _indicador(
            "Cumplimiento",
            f"{cumplimiento}%",
            "80%",
            "Óptimo"
            if cumplimiento >= 80
            else "Aceptable"
            if cumplimiento >= 60
            else "Bajo umbral",
            explicaciones.get("cumplimiento"),
        ),
        _indicador(
            "Carga Laboral",
            f"{carga}%",
            f"{resumen.get('cargaRangeMin', 0)}h–{resumen.get('cargaRangeMax', 0)}h",
            "Sobre rango óptimo" if carga > 100 else "Dentro de rango",
            explicaciones.get("carga"),
        ),
        _indicador(
            "Consultas Atendidas",
            f"{resumen.get('totalConsultas', 0)}",
            GUION,
            "Informativo",
            explicaciones.get("consultas"),
        ),
    ]
    indice = (doc.get("estadoGeneral") or {}).get("indiceEjecutivo")
    if indice:
        indicadores.append(
            {
                "nombre": "Equilibrio Operativo (Índice Ejecutivo)",
                "valor": f"{indice['avgEquilibrio']}/100",
                "meta": "≥ 85/100",
                "estado": indice["nivel"],
                "interpretacion": indice["explicacion"],
                "impacto": "Determina si el equipo puede sostener su ritmo actual sin riesgo de desgaste.",
                "recomendacion": (
                    "Revisar distribución de carga y tareas vencidas del equipo antes del próximo período."
                    if indice["nivel"] in ("Crítico", "Atención")
                    else "Mantener el seguimiento habitual."
                ),
            }
        )
    return {"kind": "teamStatus", "indicators": indicadores}


def _indicadores_estrategicos(doc: dict) -> dict:
    resumen = doc.get("teamSummary") or {}
    meta = doc.get("meta") or {}
    return {
        "kind": "strategicIndicators",
        "kpis": [
            {
                "label": "Cumplimiento",
                "valor": f"{resumen.get('avgCumplimiento', 0)}%",
                "sublabel": f"{resumen.get('totalCompletedTasks', 0)}/{resumen.get('totalTasks', 0)} tareas",
            },
            {
                "label": "Carga Laboral",
                "valor": f"{resumen.get('avgCargaPct', 0)}%",
                "sublabel": f"{resumen.get('totalCargaRealHours', 0)}h / {resumen.get('totalCargaBaseHours', 0)}h base",
            },
            {
                "label": "Consultas",
                "valor": f"{resumen.get('totalConsultas', 0)}",
                "sublabel": "Seguimiento atendido",
            },
            {
                "label": "Colaboradores",
                "valor": f"{meta.get('collaboratorCount', len(doc.get('members') or []))}",
                "sublabel": ROSTER_KIND_LABEL.get(meta.get("rosterKind"), "Equipo consolidado"),
            },
        ],
        "ranking": doc.get("ranking") or [],
    }


def _insights(doc: dict) -> dict:
    i = (doc.get("nova") or {}).get("executiveInsights") or {}
    return {
        "kind": "insights",
        "conIa": _con_ia(doc, "executiveInsights"),
        "patrones": i.get("patrones") or [],
        "cambios": i.get("cambios") or [],
        "anomalias": i.get("anomalias") or [],
        "relacionesCruzadas": i.get("relacionesCruzadas") or [],
        "hallazgosBase": [f["text"] for f in doc.get("findings") or []],
        "insightsBase": doc.get("insights") or [],
    }


def _evaluacion(doc: dict) -> dict:
    a = (doc.get("nova") or {}).get("executiveAssessment") or {}
    return {
        "kind": "assessment",
        "conIa": _con_ia(doc, "executiveAssessment"),
        "diagnosticoGeneral": a.get("diagnosticoGeneral") or NO_DISPONIBLE,
        "fortalezasEstrategicas": a.get("fortalezasEstrategicas") or [],
        "riesgosDetectados": a.get("riesgosDetectados") or [],
        "oportunidades": a.get("oportunidades") or [],
        "prioridades": a.get("prioridades") or [],
        "perspectivaEstrategica": a.get("perspectivaEstrategica") or NO_DISPONIBLE,
        "opinionEjecutiva": a.get("opinionEjecutiva") or NO_DISPONIBLE,
    }


def _recomendaciones(doc: dict) -> dict:
    enriquecidas = {
        e["id"]: e for e in (doc.get("nova") or {}).get("recommendationEnrichment") or []
    }
    filas = [
        {
            "id": r["id"],
            "text": r["text"],
            "priority": r["priority"],
            "enrichment": enriquecidas.get(r["id"]),
        }
        for r in doc.get("recommendations") or []
    ]
    return {
        "kind": "recommendations",
        "conIa": _con_ia(doc, "recommendationEnrichment"),
        "alta": [f for f in filas if f["priority"] == "alta"],
        "media": [f for f in filas if f["priority"] == "media"],
    }


def _predictiva(doc: dict) -> dict:
    p = doc.get("predictivo")
    if not p:
        return {
            "kind": "predictive",
            "available": False,
            "message": MENSAJE_SIN_PREDICCION,
            "asOfLabel": "",
            "horizonDays": 0,
            "membersAtRiskSobrecarga": 0,
            "avgCumplimientoEsperadoCierrePct": None,
            "members": [],
        }

    def etiqueta(bloque):
        if bloque and bloque.get("available"):
            return bloque["queOcurrira"]
        return (bloque or {}).get("queOcurrira") or "Sin datos suficientes para proyectar."

    miembros = []
    for m in p.get("members") or []:
        cumplimiento, sobrecarga, sub = (
            m.get("cumplimiento"),
            m.get("sobrecarga"),
            m.get("subutilizacion"),
        )
        miembros.append(
            {
                "id": m.get("id"),
                "name": m.get("name"),
                "cumplimientoLabel": etiqueta(cumplimiento),
                "sobrecargaLabel": etiqueta(sobrecarga),
                "sobrecargaNivel": sobrecarga["nivel"]
                if sobrecarga and sobrecarga.get("available")
                else GUION,
                "subutilizacionLabel": (sub or {}).get("queOcurrira") or "Sin datos.",
                "queHacer": [
                    *((cumplimiento or {}).get("queHacer") or []),
                    *((sobrecarga or {}).get("queHacer") or []),
                    *((sub or {}).get("queHacer") or []),
                ],
            }
        )
    return {
        "kind": "predictive",
        "available": True,
        "message": "",
        "asOfLabel": fecha_hora(p.get("asOf")),
        "horizonDays": p.get("horizonDays"),
        "membersAtRiskSobrecarga": p.get("membersAtRiskSobrecarga"),
        "avgCumplimientoEsperadoCierrePct": p.get("avgCumplimientoEsperadoCierrePct"),
        "members": miembros,
    }


def _tiempo(ms) -> str:
    if ms is None:
        return GUION
    return f"{ms / 1000:.1f} s" if ms >= 1000 else f"{ms} ms"


def _metadatos(doc: dict) -> dict:
    meta = doc.get("meta") or {}
    versiones = meta.get("versions") or {}
    closure = _cierre_visible(meta)
    return {
        "kind": "metadata",
        "reportId": meta.get("reportId") or GUION,
        "generatedByName": (meta.get("generatedBy") or {}).get("name") or GUION,
        "generatedAtLabel": fecha_hora(meta.get("generatedAt")),
        "fechaCorteLabel": fecha_larga(meta.get("fechaCorte")),
        "periodLabel": meta.get("periodLabel") or "Período no disponible",
        "tipoReporteLabel": TIPO_REPORTE_LABEL.get(meta.get("type"), "Informe Ejecutivo"),
        "collaboratorCount": meta.get("collaboratorCount", len(doc.get("members") or [])),
        "analyticsEngineVersion": versiones.get("analyticsEngineVersion") or GUION,
        "formulaSetVersion": versiones.get("formulaSetVersion") or GUION,
        "reportingEngineVersion": versiones.get("reportingEngineVersion") or GUION,
        "nexoVersion": versiones.get("nexoVersion") or GUION,
        "dataQualityPct": ((doc.get("estadoGeneral") or {}).get("dataQuality") or {}).get("pct", 0),
        "periodStatusLabel": PERIOD_STATUS_LABEL.get(meta.get("periodStatus"), GUION),
        "generationMsLabel": _tiempo(meta.get("generationMs")),
        "metodologicalNoteLabel": nota_metodologica(closure) if closure else None,
        "narrativaLabel": (
            "Determinista (sin IA)"
            if doc.get("novaOrigen") == "DETERMINISTA"
            else "NOVA (IA), con secciones sin IA"
            if doc.get("nova") and doc.get("novaSeccionesSinIa")
            else "NOVA (IA)"
            if doc.get("nova")
            else "Sin narrativa"
        ),
    }


def construir_paginas(doc: dict) -> list[dict]:
    """Las once páginas, en el orden fijo. Nunca se altera."""
    doc = doc or {}
    return [
        _portada(doc),
        _resumen_ejecutivo(doc),
        _estado_del_equipo(doc),
        _indicadores_estrategicos(doc),
        {"kind": "memberDetail", "members": doc.get("members") or []},
        {
            "kind": "operationalDistribution",
            "consultasByReason": (doc.get("distribuciones") or {}).get("consultasByReason") or [],
            "riskQuadrant": (doc.get("distribuciones") or {}).get("riskQuadrant") or [],
        },
        _insights(doc),
        _evaluacion(doc),
        _recomendaciones(doc),
        _predictiva(doc),
        _metadatos(doc),
    ]


__all__ = ["QUADRANT_LABEL", "SIN_DATOS", "construir_paginas"]
