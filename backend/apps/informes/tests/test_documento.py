"""Índice Ejecutivo, Estado General, narrativa determinista y las once páginas
del documento (`indiceEjecutivo.ts`, `estadoGeneral.ts`, `nova/fallbacks.ts` y
`documentModel.ts` de Nexo). Puras: no tocan la base."""

import pytest

from apps.informes.documento import construir_paginas, fecha_larga, nota_metodologica
from apps.informes.narrativa import (
    classify_indice_ejecutivo,
    narrativa_determinista,
    resolve_estado_general,
)


def _doc(**extra):
    doc = {
        "meta": {
            "reportId": "NXR-20261020-100000-ABCD",
            "type": "MENSUAL",
            "rosterKind": "CONSOLIDADO",
            "periodLabel": "marzo de 2026",
            "periodStart": "2026-03-01T00:00:00Z",
            "fechaCorte": "2026-03-31T23:59:59Z",
            "periodStatus": "HISTORICO",
            "closure": None,
            "collaboratorCount": 2,
            "generatedBy": {"userId": 7, "name": "Coral"},
            "generatedAt": "2026-10-20T15:00:00Z",
            "generationMs": 1530,
            "versions": {
                "analyticsEngineVersion": "1.5.0",
                "formulaSetVersion": "4.4",
                "reportingEngineVersion": "2.0",
                "nexoVersion": "0.1.0",
            },
        },
        "estadoGeneral": {"indiceEjecutivo": None, "dataQuality": {"pct": 90, "issues": []}},
        "teamSummary": {
            "avgCumplimiento": 85,
            "avgCargaPct": 110,
            "totalCargaRealHours": 150.5,
            "totalCargaBaseHours": 140,
            "totalCompletedTasks": 17,
            "totalConsultas": 12,
            "totalTasks": 20,
            "hoursPerDay": 8,
            "cargaRangeMin": 140,
            "cargaRangeMax": 154,
        },
        "members": [
            {"id": 1, "name": "Ana", "role": "ANALISTA_CC", "score": 80, "completedPct": 90},
            {"id": 2, "name": "Niño", "role": "ASISTENTE_GH", "score": 60, "completedPct": 70},
        ],
        "ranking": [],
        "distribuciones": {
            "consultasByReason": [
                {"reason": "FACTURAS", "count": 6, "totalMinutes": 90, "pct": 50}
            ],
            "riskQuadrant": [],
        },
        "trends": {
            "mesAnterior": {
                "label": "Mes anterior",
                "currentValue": 85,
                "compareValue": 70,
                "delta": 15,
                "direction": "mejora",
            }
        },
        "rangeTrend": None,
        "findings": [{"text": "Hallazgo de prueba.", "tone": "neutral"}],
        "insights": ["Insight de prueba."],
        "indicatorExplanations": {
            "cumplimiento": {"meaning": "m", "why": "w", "impact": "i", "action": "a"},
            "carga": {"meaning": "m", "why": "w", "impact": "i", "action": "a"},
            "consultas": {"meaning": "m", "why": "w", "impact": "i", "action": "a"},
        },
        "recommendations": [
            {"id": "revisar-bajo-cumplimiento", "text": "Revisar a Niño.", "priority": "alta"},
            {"id": "mantener-planificacion", "text": "Mantener.", "priority": "media"},
        ],
        "alerts": [{"userId": 2, "name": "Niño", "type": "sobrecarga", "value": 130}],
        "predictivo": None,
        "novaOrigen": "DETERMINISTA",
    }
    doc.update(extra)
    doc["nova"] = narrativa_determinista(doc)
    return doc


@pytest.mark.parametrize(
    ("perf", "equi", "nivel", "valor"),
    [
        (90, 84, "Excelente", 87.0),
        (70, 72, "Bueno", 71.0),
        (50, 51, "Atención", 50.5),
        (10, 20, "Crítico", 15.0),
    ],
)
def test_indice_ejecutivo(perf, equi, nivel, valor):
    resultado = classify_indice_ejecutivo(perf, equi)
    assert (resultado["nivel"], resultado["valor"]) == (nivel, valor)


def test_estado_general_con_y_sin_indice_y_vacio():
    aproximado = resolve_estado_general(_doc())
    # Cumplimiento 85 y carga 110 (90 de cercanía al 100%): (85 + 90) / 2 = 87,5.
    assert aproximado["valor"] == 87.5 and aproximado["nivel"] == "Excelente"
    assert aproximado["fromIndiceEjecutivo"] is False
    assert "aproximación" in aproximado["explicacion"]

    indice = {"valor": 60, "nivel": "Atención", "color": "yellow", "explicacion": "x"}
    con_indice = resolve_estado_general(
        _doc(estadoGeneral={"indiceEjecutivo": indice, "dataQuality": {"pct": 90}})
    )
    assert con_indice["nivel"] == "Atención" and con_indice["fromIndiceEjecutivo"] is True

    vacio = resolve_estado_general({"members": [], "teamSummary": {"totalTasks": 0}})
    assert vacio["nivel"] == "Sin datos para el período" and vacio["valor"] is None


def test_narrativa_determinista_con_los_textos_de_nexo():
    nova = _doc()["nova"]
    resumen = nova["executiveSummary"]
    assert resumen["situacionGeneral"].startswith(
        'El equipo cierra el período en un nivel general "Excelente"'
    )
    assert resumen["fortalezas"] == "Ana lidera el desempeño del equipo con 90% de cumplimiento."
    assert "Niño (carga laboral: 130%)" in resumen["aspectosAtencion"]
    assert nova["executiveInsights"]["cambios"] == [
        "El cumplimiento del equipo mejoró respecto al mes anterior (70% → 85%)."
    ]
    assert nova["executiveInsights"]["relacionesCruzadas"][0].startswith("El cumplimiento alto")
    evaluacion = nova["executiveAssessment"]
    assert evaluacion["prioridades"] == ["Revisar a Niño."]
    assert "Niño representa el caso" in evaluacion["opinionEjecutiva"]
    assert [e["id"] for e in nova["recommendationEnrichment"]] == [
        "revisar-bajo-cumplimiento",
        "mantener-planificacion",
    ]
    assert nova["scenarios"] is None


def test_paginas_en_orden_con_etiquetas_en_la_hora_de_la_intranet():
    paginas = construir_paginas(_doc())
    portada, metadatos = paginas[0], paginas[-1]
    # 15:00 UTC son las 10:00 en Guayaquil.
    assert portada["generatedAtLabel"] == "20/10/2026 10:00"
    assert portada["fechaCorteLabel"] == "31 de marzo de 2026"
    assert portada["closureStatusLabel"] is None
    assert metadatos["generationMsLabel"] == "1.5 s"
    assert metadatos["narrativaLabel"] == "Determinista (sin IA)"
    recomendaciones = paginas[8]
    assert [r["id"] for r in recomendaciones["alta"]] == ["revisar-bajo-cumplimiento"]
    assert (
        recomendaciones["alta"][0]["enrichment"]["tiempoEstimado"] == "Inmediato — próximos 7 días."
    )
    predictiva = paginas[9]
    assert predictiva["available"] is False and "mes calendario en curso" in predictiva["message"]


def test_documento_migrado_incompleto_no_revienta():
    paginas = construir_paginas({"members": []})
    assert paginas[0]["reportId"] == "—"
    assert paginas[0]["estadoGeneralLabel"] == "Sin datos para el período"
    assert paginas[1]["situacionGeneral"] == "No disponible."
    assert paginas[-1]["periodLabel"] == "Período no disponible"


def test_nota_metodologica_del_cierre():
    cierre = {
        "closureType": "MANUAL",
        "cutoffDate": "2026-03-20T00:00:00Z",
        "closedAt": "2026-04-05T15:00:00Z",
        "workingDaysConsidered": 14,
        "workingHoursConsidered": 91.0,
    }
    nota = nota_metodologica(cierre)
    assert "regularizada manualmente" in nota and "hasta el 20 de marzo de 2026" in nota
    assert nota_metodologica({**cierre, "closureType": "NORMAL"}) is None
    assert fecha_larga(None) == "—"
