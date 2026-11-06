import { vi } from "vitest";

/*
 * Datos de prueba de Informes ejecutivos, con la forma exacta de las
 * respuestas de `/api/v1/informes/` (ver `apps.informes.views`,
 * `services.fila_del_listado`/`detalle` y `documento.construir_paginas`).
 */

export const ME_VER = {
  permissions: ["informes_gh.ver"],
  alcance_completo: false,
  scope: "COORDINADOR",
};
export const ME_GENERAR = {
  permissions: ["informes_gh.ver", "informes_gh.generar"],
  alcance_completo: false,
  scope: "COORDINADOR",
};
export const ME_ADMIN = {
  permissions: [
    "informes_gh.ver",
    "informes_gh.generar",
    "informes_gh.administrar",
  ],
  alcance_completo: true,
  scope: "JEFE",
};

export function fila(extra = {}) {
  return {
    report_id: "NXR-20261001-ABC123",
    type: "MENSUAL",
    type_label: "Mensual",
    scope: "COORDINADOR",
    origin: "GENERATED",
    integrity_flag: "FULL",
    period_label: "Octubre 2026",
    period_start: "2026-10-01T05:00:00Z",
    period_end: "2026-11-01T04:59:59Z",
    fecha_corte: "2026-10-31T23:59:59-05:00",
    period_status: "CERRADO",
    period_status_label: "Cerrado",
    collaborator_count: 3,
    generated_by: { id: 1, name: "Ana" },
    generated_at: "2026-11-02T15:00:00Z",
    ...extra,
  };
}

export const LISTA = {
  page: 1,
  page_size: 20,
  total: 2,
  reports: [
    fila(),
    fila({
      report_id: "NXR-20260901-XYZ789",
      type: "RANGO_MESES",
      type_label: "Rango de meses",
      period_label: "Julio – Septiembre 2026",
      integrity_flag: "PARTIAL",
      origin: "LEGACY_MIGRATION",
      period_status: "HISTORICO",
      period_status_label: "Histórico",
    }),
  ],
};

export const LISTA_VACIA = { page: 1, page_size: 20, total: 0, reports: [] };

export const ROSTER = {
  users: [
    {
      id: 2,
      name: "Luis",
      full_name: "Luis Pérez",
      role: "ANALISTA_CC",
      cargo: "Analista de clima",
      unidad_id: 10,
      unidad: "Clima y Cultura",
    },
    {
      id: 3,
      name: "Marta",
      full_name: "Marta Ríos",
      role: "ASISTENTE_GH",
      cargo: "Asistente",
      unidad_id: 11,
      unidad: "Nómina",
    },
    {
      id: 4,
      name: "Pedro",
      full_name: "Pedro Mena",
      role: "ANALISTA_CC",
      cargo: null,
      unidad_id: null,
      unidad: null,
    },
  ],
  user_ids: [2, 3, 4],
  scope: "COORDINADOR",
  roster_kind: "CONSOLIDADO",
};

export const CIERRE_ABIERTO = {
  closed: false,
  cutoff_date: null,
  closure_type: null,
  closed_at: null,
  calendar_days_total: null,
  calendar_days_considered: null,
  working_days_considered: null,
  working_hours_considered: null,
};

export const CIERRE_ANTICIPADO = {
  closed: true,
  cutoff_date: "2026-10-28",
  closure_type: "EARLY",
  closed_at: "2026-10-28T20:00:00Z",
  calendar_days_total: 31,
  calendar_days_considered: 28,
  working_days_considered: 19,
  working_hours_considered: 152,
};

/** Las once páginas, en el orden fijo del servidor. */
export function paginas() {
  return [
    {
      kind: "cover",
      reportId: "NXR-20261001-ABC123",
      tipoReporteLabel: "Informe Mensual",
      periodLabel: "Octubre 2026",
      fechaCorteLabel: "31 de octubre de 2026",
      generatedAtLabel: "02/11/2026 10:00",
      generatedByName: "Ana",
      estadoGeneralLabel: "Estable",
      estadoGeneralColor: "green",
      scoreGeneral: 82,
      semaforoLabel: "El equipo sostiene su ritmo.",
      analyticsEngineVersion: "2.1",
      formulaSetVersion: "1.4",
      closureStatusLabel: null,
      coverageLabel: null,
      workingDaysConsideredLabel: null,
      workingHoursConsideredLabel: null,
      metodologicalNoteLabel: null,
    },
    {
      kind: "executiveSummary",
      situacionGeneral: "El equipo cumplió la mayoría de sus tareas.",
      fortalezas: "Buen cumplimiento.",
      aspectosAtencion: "Carga alta en una persona.",
      conclusion: "Mantener el seguimiento.",
    },
    {
      kind: "teamStatus",
      indicators: [
        {
          nombre: "Cumplimiento",
          valor: "85%",
          meta: "80%",
          estado: "Óptimo",
          interpretacion: "Se cumple la meta.",
          impacto: "Alto.",
          recomendacion: "Mantener.",
        },
      ],
    },
    {
      kind: "strategicIndicators",
      kpis: [
        { label: "Cumplimiento", valor: "85%", sublabel: "17/20 tareas" },
        { label: "Colaboradores", valor: "3", sublabel: "Equipo consolidado" },
      ],
      ranking: [
        {
          id: 2,
          name: "Luis",
          role: "ANALISTA_CC",
          score: 90,
          completedPct: 95,
        },
      ],
    },
    {
      kind: "memberDetail",
      members: [
        {
          id: 2,
          name: "Luis",
          role: "ANALISTA_CC",
          completedPct: 95,
          cargaColor: "red",
          cargaLabel: "Sobrecarga",
          overdueCount: 1,
          estadoOperativo: { estado: "Equilibrio Estable" },
          principalHallazgo: "Redistribuir tareas.",
        },
      ],
    },
    {
      kind: "operationalDistribution",
      consultasByReason: [
        {
          reason: "Vacaciones",
          count: 4,
          totalMinutes: 60,
          pct: 40,
          trendPct: 10,
          interpretation: "Motivo más frecuente.",
        },
      ],
      riskQuadrant: [
        {
          name: "Luis",
          completedPct: 95,
          cargaPct: 120,
          quadrant: "atencion-carga",
        },
      ],
    },
    {
      kind: "insights",
      patrones: ["Patrón A"],
      cambios: [],
      anomalias: [],
      relacionesCruzadas: [],
      hallazgosBase: [],
      insightsBase: [],
    },
    {
      kind: "assessment",
      diagnosticoGeneral: "Diagnóstico estable.",
      fortalezasEstrategicas: [],
      riesgosDetectados: ["Sobrecarga puntual"],
      oportunidades: [],
      prioridades: [],
      perspectivaEstrategica: "Positiva.",
      opinionEjecutiva: "Sin alarmas.",
    },
    {
      kind: "recommendations",
      alta: [
        {
          id: "r1",
          text: "Redistribuir la carga de Luis.",
          priority: "alta",
          enrichment: null,
        },
      ],
      media: [],
    },
    {
      kind: "predictive",
      available: false,
      message: "Analytics Predictivo solo proyecta hacia adelante.",
      asOfLabel: "",
      horizonDays: 0,
      membersAtRiskSobrecarga: 0,
      avgCumplimientoEsperadoCierrePct: null,
      members: [],
    },
    {
      kind: "metadata",
      reportId: "NXR-20261001-ABC123",
      generatedByName: "Ana",
      generatedAtLabel: "02/11/2026 10:00",
      fechaCorteLabel: "31 de octubre de 2026",
      periodLabel: "Octubre 2026",
      tipoReporteLabel: "Informe Mensual",
      collaboratorCount: 3,
      analyticsEngineVersion: "2.1",
      formulaSetVersion: "1.4",
      reportingEngineVersion: "2.0",
      nexoVersion: "—",
      dataQualityPct: 88,
      periodStatusLabel: "Cerrado",
      generationMsLabel: "1.2 s",
      metodologicalNoteLabel: null,
      narrativaLabel: "Determinista (sin IA)",
    },
  ];
}

export function detalle(extra = {}) {
  return {
    ...fila(),
    generation_ms: 1200,
    analytics_engine_version: "2.1",
    formula_set_version: "1.4",
    reporting_engine_version: "2.0",
    nexo_version: "",
    filters: {},
    data: {
      novaOrigen: "DETERMINISTA",
      meta: { reportId: "NXR-20261001-ABC123" },
    },
    pages: paginas(),
    nova: {},
    nova_degraded: false,
    data_quality: {
      pct: 88,
      issues: [
        {
          key: "sin_estimar",
          label: "Tareas sin tiempo objetivo definido",
          count: 4,
        },
      ],
    },
    ...extra,
  };
}

export const BITACORA = {
  report_id: "NXR-20261001-ABC123",
  events: [
    {
      id: 1,
      report_id: "NXR-20261001-ABC123",
      action: "generated",
      action_label: "Generado",
      user: { id: 1, name: "Ana" },
      step: "",
      message: "",
      period: "2026-10",
      fecha_corte: null,
      filters_applied: {},
      collaborator_count: 3,
      generation_ms: 1200,
      created_at: "2026-11-02T15:00:00Z",
    },
  ],
};

export const INCIDENTES = {
  page: 1,
  page_size: 20,
  total: 1,
  incidents: [
    {
      id: 7,
      report_id: "NXR-20260901-XYZ789",
      field_path: "teamSummary.avgCumplimiento",
      expected_value: 80,
      actual_value: 78,
      source: "kpis_team",
      user_id: 1,
      detected_at: "2026-10-01T15:00:00Z",
    },
  ],
};

export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

export function servicioFalso(me = ME_GENERAR) {
  return {
    yo: vi.fn().mockResolvedValue(me),
    roster: vi.fn().mockResolvedValue(ROSTER),
    estadoDeCierre: vi.fn().mockResolvedValue(CIERRE_ABIERTO),
    generar: vi.fn().mockResolvedValue({ informe: detalle(), nuevo: true }),
    listar: vi.fn().mockResolvedValue(LISTA),
    obtener: vi.fn().mockResolvedValue(detalle()),
    exportarExcel: vi.fn().mockResolvedValue("NXR-20261001-ABC123.xlsx"),
    registrarPdf: vi.fn().mockResolvedValue(undefined),
    bitacora: vi.fn().mockResolvedValue(BITACORA),
    incidentes: vi.fn().mockResolvedValue(INCIDENTES),
  };
}
