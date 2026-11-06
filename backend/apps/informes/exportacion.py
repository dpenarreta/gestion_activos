"""El informe ejecutivo en Excel (`renderReportExcel.ts` de Nexo).

Se arma sobre las MISMAS páginas que alimentan la vista imprimible
(`documento.construir_paginas`), así el Excel y el PDF nunca difieren. Una
hoja por página, con los nombres de Nexo (31 caracteres como máximo, lo que
admite Excel).

Convenciones de la intranet (`apps.analytics.exportacion`): números como
números (horas y porcentajes se pueden sumar y filtrar), cabeceras en negrita
y todo texto pasa por `neutralizar` (inyección de fórmulas). Los roles van con
su nombre legible, no con el código de Nexo.
"""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font, PatternFill

from apps.core.hojas_de_calculo import neutralizar
from apps.tasks.roles import role_label

from .documento import QUADRANT_LABEL

CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
RELLENO_CABECERA = PatternFill("solid", fgColor="D9E2F3")


def _pagina(paginas: list[dict], kind: str) -> dict | None:
    return next((p for p in paginas if p.get("kind") == kind), None)


class _Hoja:
    """Una hoja de solo escritura con filas de título y de cabecera
    resaltadas."""

    def __init__(self, libro, titulo: str, anchos: list[int]):
        self.hoja = libro.create_sheet(titulo[:31])
        for indice, ancho in enumerate(anchos):
            self.hoja.column_dimensions[chr(ord("A") + indice)].width = ancho

    def fila(self, *valores):
        self.hoja.append([neutralizar(v) for v in valores])

    def resaltada(self, *valores):
        celdas = []
        for valor in valores:
            celda = WriteOnlyCell(self.hoja, value=neutralizar(valor))
            celda.font = Font(bold=True)
            celda.fill = RELLENO_CABECERA
            celda.alignment = Alignment(vertical="center", wrap_text=True)
            celdas.append(celda)
        self.hoja.append(celdas)

    def vacia(self):
        self.hoja.append([])


def _resumen(libro, portada, resumen):
    if not portada:
        return
    h = _Hoja(libro, "Resumen", [32, 100])
    h.resaltada("Informe ejecutivo — Gestión Humana", "")
    for etiqueta, valor in (
        ("Tipo de reporte", portada["tipoReporteLabel"]),
        ("Período", portada["periodLabel"]),
        ("Fecha de corte", portada["fechaCorteLabel"]),
        ("Generado", portada["generatedAtLabel"]),
        ("Generado por", portada["generatedByName"]),
        ("Report ID", portada["reportId"]),
        ("Estado General", portada["estadoGeneralLabel"]),
        ("Score General", portada["scoreGeneral"] if portada["scoreGeneral"] is not None else "—"),
        ("Explicación", portada["semaforoLabel"] or "—"),
        ("Analytics Engine", f"v{portada['analyticsEngineVersion']}"),
        ("Formula Set", f"v{portada['formulaSetVersion']}"),
    ):
        h.fila(etiqueta, valor)
    if portada["closureStatusLabel"]:
        h.vacia()
        h.resaltada("ESTADO DEL PERÍODO", "")
        h.fila("Estado del período", portada["closureStatusLabel"])
        h.fila("Cobertura", portada["coverageLabel"] or "—")
        h.fila("Días hábiles considerados", portada["workingDaysConsideredLabel"] or "—")
        h.fila("Horas base consideradas", portada["workingHoursConsideredLabel"] or "—")
        h.fila("Nota metodológica", portada["metodologicalNoteLabel"] or "—")
    if resumen:
        h.vacia()
        h.resaltada("EXECUTIVE SUMMARY", "")
        h.fila("Situación General", resumen["situacionGeneral"])
        h.fila("Fortalezas", resumen["fortalezas"])
        h.fila("Aspectos de Atención", resumen["aspectosAtencion"])
        h.fila("Conclusión", resumen["conclusion"])


def _estado(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Estado General", [30, 14, 18, 20, 50, 50, 50])
    h.resaltada(
        "Indicador", "Valor", "Meta", "Estado", "Interpretación", "Impacto", "Recomendación"
    )
    for i in pagina["indicators"]:
        h.fila(
            i["nombre"],
            i["valor"],
            i["meta"],
            i["estado"],
            i["interpretacion"],
            i["impacto"],
            i["recomendacion"],
        )


def _estrategicos(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Indicadores Estrategicos", [8, 32, 30, 12, 18])
    h.resaltada("KPI", "Valor", "Detalle")
    for k in pagina["kpis"]:
        h.fila(k["label"], k["valor"], k["sublabel"])
    h.vacia()
    h.resaltada("RANKING", "", "", "", "")
    h.resaltada("#", "Nombre", "Rol", "Score", "Cumplimiento (%)")
    for posicion, r in enumerate(pagina["ranking"], start=1):
        h.fila(posicion, r["name"], role_label(r.get("role") or ""), r["score"], r["completedPct"])


def _detalle(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Detalle por Colaborador", [28, 26, 8, 14, 10, 12, 12, 10, 10, 22, 26])
    h.resaltada(
        "Nombre",
        "Rol",
        "Score",
        "Cumplimiento (%)",
        "Carga (%)",
        "Carga real (h)",
        "Base (h)",
        "Vencidas",
        "Consultas",
        "Equilibrio Operativo",
        "Acción sugerida",
    )
    for m in pagina["members"]:
        h.fila(
            m.get("name"),
            role_label(m.get("role") or ""),
            m.get("score"),
            m.get("completedPct"),
            m.get("cargaPct"),
            m.get("cargaRealHours"),
            m.get("cargaBaseHours"),
            m.get("overdueCount"),
            m.get("seguimientoTotal"),
            (m.get("estadoOperativo") or {}).get("estado") or "—",
            m.get("principalHallazgo") or "—",
        )


def _distribucion(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Distribucion Operativa", [32, 12, 12, 10, 14, 80])
    h.resaltada("Motivo", "Cantidad", "Minutos", "%", "Tendencia (%)", "Interpretación")
    for m in pagina["consultasByReason"]:
        h.fila(
            m.get("reason"),
            m.get("count"),
            m.get("totalMinutes"),
            m.get("pct", ""),
            m.get("trendPct") if m.get("trendPct") is not None else "",
            m.get("interpretation") or "",
        )
    h.vacia()
    h.resaltada("MATRIZ DE RIESGO", "", "", "", "", "")
    h.resaltada("Nombre", "Cumplimiento (%)", "Carga (%)", "Cuadrante")
    for q in pagina["riskQuadrant"]:
        h.fila(
            q.get("name"),
            q.get("completedPct"),
            q.get("cargaPct"),
            QUADRANT_LABEL.get(q.get("quadrant"), q.get("quadrant")),
        )


def _lista(h, titulo, elementos):
    h.vacia()
    h.resaltada(titulo)
    for e in elementos:
        h.fila(e)


def _insights(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Insights", [120])
    h.resaltada("EXECUTIVE INSIGHTS")
    _lista(h, "Patrones", pagina["patrones"])
    _lista(h, "Cambios", pagina["cambios"])
    _lista(h, "Anomalías", pagina["anomalias"])
    _lista(h, "Relaciones Cruzadas", pagina["relacionesCruzadas"])
    _lista(h, "Hallazgos", pagina["hallazgosBase"])
    _lista(h, "Insights del equipo", pagina["insightsBase"])


def _evaluacion(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Executive Assessment", [120])
    h.resaltada("EXECUTIVE ASSESSMENT")
    _lista(h, "Diagnóstico General", [pagina["diagnosticoGeneral"]])
    _lista(h, "Fortalezas Estratégicas", pagina["fortalezasEstrategicas"])
    _lista(h, "Riesgos Detectados", pagina["riesgosDetectados"])
    _lista(h, "Oportunidades", pagina["oportunidades"])
    _lista(h, "Prioridades", pagina["prioridades"])
    _lista(h, "Perspectiva Estratégica", [pagina["perspectivaEstrategica"]])
    _lista(h, "Opinión Ejecutiva", [pagina["opinionEjecutiva"]])


def _recomendaciones(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Recomendaciones", [10, 60, 50, 40, 24, 36, 36, 30, 26])
    h.resaltada(
        "Prioridad",
        "Recomendación",
        "Justificación",
        "Impacto Esperado",
        "Área Afectada",
        "Beneficio",
        "Complejidad Estimada",
        "Tiempo Estimado",
        "Responsable Sugerido",
    )
    for r in [*pagina["alta"], *pagina["media"]]:
        e = r.get("enrichment") or {}
        h.fila(
            "ALTA" if r["priority"] == "alta" else "MEDIA",
            r["text"],
            e.get("justificacion", ""),
            e.get("impactoEsperado", ""),
            e.get("areaAfectada", ""),
            e.get("beneficio", ""),
            e.get("complejidadEstimada", ""),
            e.get("tiempoEstimado", ""),
            e.get("responsableSugerido", ""),
        )


def _predictiva(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Analytics Predictivo", [28, 50, 50, 16, 50, 60])
    if not pagina["available"]:
        h.resaltada("ANALYTICS PREDICTIVO")
        h.fila(pagina["message"])
        return
    h.resaltada("ANALYTICS PREDICTIVO", f"Proyección al {pagina['asOfLabel']}")
    h.fila("Horizonte (días)", pagina["horizonDays"])
    h.fila(
        "Cumplimiento esperado al cierre (%)",
        pagina["avgCumplimientoEsperadoCierrePct"]
        if pagina["avgCumplimientoEsperadoCierrePct"] is not None
        else "—",
    )
    h.fila("Colaboradores en riesgo de sobrecarga", pagina["membersAtRiskSobrecarga"])
    h.vacia()
    h.resaltada(
        "Colaborador", "Cumplimiento", "Carga", "Nivel Sobrecarga", "Subutilización", "Qué hacer"
    )
    for m in pagina["members"]:
        h.fila(
            m["name"],
            m["cumplimientoLabel"],
            m["sobrecargaLabel"],
            m["sobrecargaNivel"],
            m["subutilizacionLabel"],
            " · ".join(m["queHacer"]),
        )


def _metadatos(libro, pagina):
    if not pagina:
        return
    h = _Hoja(libro, "Metadatos", [36, 100])
    for etiqueta, valor in (
        ("Report ID", pagina["reportId"]),
        ("Generado por", pagina["generatedByName"]),
        ("Fecha de generación", pagina["generatedAtLabel"]),
        ("Fecha de corte", pagina["fechaCorteLabel"]),
        ("Período", pagina["periodLabel"]),
        ("Tipo de reporte", pagina["tipoReporteLabel"]),
        ("Estado del período", pagina["periodStatusLabel"]),
        ("Colaboradores incluidos", pagina["collaboratorCount"]),
        ("Versión Analytics Engine", f"v{pagina['analyticsEngineVersion']}"),
        ("Versión Formula Set", f"v{pagina['formulaSetVersion']}"),
        ("Versión Executive Reporting Engine", f"v{pagina['reportingEngineVersion']}"),
        ("Versión del sistema", f"v{pagina['nexoVersion']}"),
        ("Calidad del dato (%)", pagina["dataQualityPct"]),
        ("Tiempo de generación", pagina["generationMsLabel"]),
        ("Narrativa", pagina["narrativaLabel"]),
    ):
        h.fila(etiqueta, valor)
    if pagina["metodologicalNoteLabel"]:
        h.vacia()
        h.fila("Nota metodológica", pagina["metodologicalNoteLabel"])


def libro_del_informe(paginas: list[dict]) -> bytes:
    libro = Workbook(write_only=True)
    _resumen(libro, _pagina(paginas, "cover"), _pagina(paginas, "executiveSummary"))
    _estado(libro, _pagina(paginas, "teamStatus"))
    _estrategicos(libro, _pagina(paginas, "strategicIndicators"))
    _detalle(libro, _pagina(paginas, "memberDetail"))
    _distribucion(libro, _pagina(paginas, "operationalDistribution"))
    _insights(libro, _pagina(paginas, "insights"))
    _evaluacion(libro, _pagina(paginas, "assessment"))
    _recomendaciones(libro, _pagina(paginas, "recommendations"))
    _predictiva(libro, _pagina(paginas, "predictive"))
    _metadatos(libro, _pagina(paginas, "metadata"))
    buffer = BytesIO()
    libro.save(buffer)
    return buffer.getvalue()
