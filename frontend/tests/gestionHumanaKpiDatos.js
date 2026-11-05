/*
 * Datos de prueba de Desempeño (motor de KPI), con la forma exacta del
 * backend (`apps/analytics`, snake_case), tomada de respuestas reales del
 * servidor local.
 */
import { vi } from "vitest";

export const ME = {
  user_id: 1,
  permissions: ["kpi.acceder"],
  role: "ASISTENTE_GH",
  roles: ["ASISTENTE_GH"],
  has_cargo: true,
  team_size: 0,
  is_admin: false,
  engine_version: "1.5.0",
  formula_set_version: "4.4",
};

export const LIDER = {
  ...ME,
  permissions: [
    "kpi.acceder",
    "kpi.equipo",
    "kpi.ejecutivo",
    "inteligencia_preventiva.ver",
  ],
  role: "COORDINADOR_NACIONAL",
  roles: ["COORDINADOR_NACIONAL"],
  team_size: 2,
};

export const DIRECCION = {
  ...LIDER,
  role: "JEFE_NACIONAL",
  roles: ["JEFE_NACIONAL"],
};

export const ADMIN = {
  ...LIDER,
  permissions: [...LIDER.permissions, "kpi.administrar"],
  is_admin: true,
};

const metrica = (extra) => ({
  real_hours: 0,
  base_hours: 6.5,
  pct: 0,
  color: "red",
  range_min: 6.5,
  range_max: 7.5,
  label: "Subutilización",
  is_weekend: false,
  ...extra,
});

export function cargaTiempo(extra = {}) {
  return {
    diaria: metrica({
      is_holiday: false,
      medico_leave_minutes: 0,
      medico_leave_full_day: false,
      personal_leave_minutes: 0,
      personal_leave_full_day: false,
      vacaciones_full_day: false,
      special_status_type: null,
    }),
    semanal: metrica({
      real_hours: 21,
      base_hours: 19.5,
      pct: 108,
      color: "green",
      range_min: 19.5,
      range_max: 22.5,
      label: "Óptimo",
      week_start_label: "04/11",
      week_end_label: "06/11",
      business_days: 3,
      weekend_hours: 0,
      special_status_type: null,
    }),
    mensual: metrica({
      real_hours: 30.5,
      base_hours: 140,
      pct: 22,
      range_min: 140,
      range_max: 142.5,
      month_label: "noviembre 2026",
      business_days: 19,
      weekend_hours: 0,
      holiday_hours: 0,
      medico_leave_minutes: 0,
      personal_leave_minutes: 0,
      vacaciones_minutes: 0,
      special_status_type: null,
    }),
    horas_efectivas_por_dia: 6.5,
    workload_limit_low: 5.5,
    workload_limit_high: 7.5,
    workload_limit_overload: 8.5,
    effective_hours_per_dia: 6.5,
    effective_limit_low: 5.5,
    effective_limit_base: 6.5,
    effective_limit_high: 7.5,
    effective_limit_overload: 8.5,
    kpi_start_date: null,
    daily_history: [
      {
        date: "2026-11-02",
        day_label: "02/11",
        special_status_type: null,
        real_hours: 0,
        base_hours: 0,
        color: "green",
        label: "Óptimo",
        kind: "holiday",
      },
      {
        date: "2026-11-03",
        day_label: "03/11",
        special_status_type: null,
        real_hours: 7,
        base_hours: 6.5,
        color: "green",
        label: "Óptimo",
        kind: "normal",
      },
    ],
    weekly_history: [
      {
        week_label: "Sem 1",
        real_hours: 21,
        base_hours: 19.5,
        color: "green",
        label: "Óptimo",
        special_status_type: null,
      },
    ],
    sensitive_detail_visible: true,
    ...extra,
  };
}

/** La carga con un permiso médico de día completo hoy, tal como la ve el
 * titular (sin enmascarar). */
export function cargaConPermisoMedico() {
  const base = cargaTiempo();
  return {
    ...base,
    diaria: {
      ...base.diaria,
      medico_leave_full_day: true,
      medico_leave_minutes: 390,
    },
    mensual: { ...base.mensual, medico_leave_minutes: 480 },
    daily_history: [
      ...base.daily_history,
      {
        ...base.daily_history[1],
        date: "2026-11-04",
        day_label: "04/11",
        real_hours: 0,
        kind: "leave-medico",
      },
    ],
  };
}

/** La misma carga como la envía el servidor a quien no puede ver el motivo
 * (`redact_sensitive_workload_detail`): sin tipo, con `ausencia_minutes`. */
export function cargaEnmascarada() {
  const base = cargaTiempo();
  return {
    ...base,
    diaria: {
      ...base.diaria,
      medico_leave_minutes: 0,
      medico_leave_full_day: false,
      personal_leave_minutes: 390,
      personal_leave_full_day: true,
      vacaciones_full_day: false,
      special_status_type: null,
    },
    mensual: {
      ...base.mensual,
      medico_leave_minutes: 0,
      personal_leave_minutes: 0,
      vacaciones_minutes: 0,
      ausencia_minutes: 480,
      special_status_type: null,
    },
    daily_history: [
      ...base.daily_history,
      {
        ...base.daily_history[1],
        date: "2026-11-04",
        day_label: "04/11",
        real_hours: 0,
        kind: "leave-generic",
      },
    ],
    sensitive_detail_visible: false,
  };
}

export function kpi(extra = {}) {
  return {
    user: { id: 1, name: "Ana", role: "ASISTENTE_GH" },
    period: { month: "2026-11" },
    cumplimiento: {
      total: 4,
      completed: 3,
      completed_on_time: 3,
      in_progress: 1,
      pending: 0,
      overdue: 1,
      completed_pct: 75,
      overdue_pct: 25,
      avg_delay_days: 2,
      color: "yellow",
      explain: {
        formula: "completadas_a_tiempo / total_tareas × 100",
        steps: ["Tareas del período: 4", "Cumplimiento = 3 / 4 = 75%"],
      },
    },
    carga_laboral: {
      estimated_hours: 140,
      real_hours: 30.5,
      ratio: 22,
      color: "red",
    },
    carga_tiempo: cargaTiempo(),
    risk_alerts: [],
    cumplimiento_por_prioridad: [
      { priority: "ALTA", total: 2, completed_on_time: 1, pct: 50 },
      { priority: "MEDIA", total: 2, completed_on_time: 2, pct: 100 },
      { priority: "BAJA", total: 0, completed_on_time: 0, pct: 0 },
    ],
    seguimiento: {
      total: 3,
      by_reason: [
        {
          reason: "NOVEDADES_PAGO",
          count: 2,
          total_minutes: 45,
          avg_minutes: 23,
        },
        { reason: "FACTURAS", count: 1, total_minutes: 15, avg_minutes: 15 },
      ],
    },
    calidad: {
      avg_progress: 40,
      recurring_completed: 1,
      recurring_total: 2,
      recurring_pct: 50,
    },
    actividad: { total_comments: 5, assigned_by_others: 2, own_tasks: 2 },
    score: 62,
    horas_by_week: [{ week: "Sem 1", estimated: 6, real: 5 }],
    cumplimiento_history: [
      { month: "2026-10", label: "oct. 26", completed_pct: 80 },
      { month: "2026-11", label: "nov. 26", completed_pct: 75 },
    ],
    tasks: [
      {
        id: 7,
        title: "Informe de clima laboral",
        type: "FIJA",
        status: "EN_PROGRESO",
        end_date: "2026-11-03T00:00:00+00:00",
        delay_days: 2,
        color: "red",
      },
    ],
    prev_month: {
      completed_pct: 80,
      carga_ratio: 30,
      total_tasks: 3,
      seguimiento_total: 1,
    },
    ...extra,
  };
}

const factor = (name, raw_label, weight, points, extra = {}) => ({
  name,
  raw_label,
  weight,
  points,
  detail: `${raw_label} → ${points} pts`,
  ...extra,
});

export const BUNDLE = {
  data_quality: {
    pct: 90,
    issues: [
      {
        key: "sin_horas_config",
        label: "Horas efectivas sin configurar",
        count: 1,
      },
    ],
  },
  health_score: {
    score: 45.5,
    classification: "Crítico",
    classification_color: "red",
    factors: [factor("Cumplimiento", "75%", 25, 18.75)],
    engine_version: "1.5.0",
    explain: { formula: "Σ", steps: [] },
  },
  performance_score: {
    score: 72.5,
    classification: "Riesgo",
    classification_color: "yellow",
    factors: [
      factor("Cumplimiento", "75%", 35, 26.25, {
        normalized_value: 75,
        raw_value: 75,
      }),
      factor("Consistencia", "Sin historial suficiente", 25, 17.5, {
        normalized_value: 70,
        raw_value: 70,
      }),
    ],
    engine_version: "1.5.0",
    formula_set_version: "4.4",
    explain: {
      formula: "Σ (NormalizationEngine(valor) × peso%)",
      steps: ["Cumplimiento: 75%"],
    },
  },
  consistency: { available: false, reason: "Historial insuficiente" },
  trends: {
    cumplimiento: {
      semana_anterior: { available: false, reason: "Sin historial suficiente" },
      mes_anterior: {
        available: true,
        direction: "empeoro",
        absolute_diff: -5,
        pct_diff: -6,
        current: 75,
        compared: 80,
      },
      promedio_6_meses: {
        available: false,
        reason: "Sin historial suficiente",
      },
    },
    carga: {
      semana_anterior: {
        available: true,
        direction: "estable",
        absolute_diff: 0,
        pct_diff: 0,
        current: 0,
        compared: 0,
      },
      mes_anterior: {
        available: true,
        direction: "estable",
        absolute_diff: 0,
        pct_diff: 0,
        current: 0,
        compared: 0,
      },
      promedio_6_meses: {
        available: true,
        direction: "estable",
        absolute_diff: 0,
        pct_diff: 0,
        current: 0,
        compared: 0,
      },
    },
  },
  prediction: {
    available: true,
    confidence: "alta",
    confidence_pct: 67,
    weeks_of_data: 6,
    carga_proxima_semana_horas: 30,
    cumplimiento_estimado_cierre_mes: 78,
    cumplimiento_estimado_rango: { min: 70, max: 85 },
    horas_para_rango_optimo: 12,
    max_projection_days: 30,
  },
  anomalies: {
    available: false,
    reason: "Insuficiente historial para detectar anomalías",
    anomalies: [],
  },
  alerts: [
    {
      severity: "red",
      message: "3 tareas vencidas de prioridad Alta.",
      suggested_action: "Priorizar el cierre de las vencidas.",
      rule: "vencidas_alta",
      detected_at: "2026-11-05T15:00:00Z",
    },
  ],
  alerts_history: [],
  engine_version: "1.5.0",
  formula_set_version: "4.4",
  last_updated: "2026-11-05T17:23:43Z",
  cache_active: false,
};

const insight = (id, tone, hallazgo) => ({
  id,
  tone,
  hallazgo,
  explicacion: `Explicación de ${hallazgo}`,
  evidencia: [{ label: "Cumplimiento", before: "—", after: "75%" }],
  accion: {
    what: "Completar las tareas pendientes de este mes.",
    who: "El colaborador.",
    how_much: "1 tarea",
    when: "Antes de fin de mes.",
    impact: [{ metric: "Performance Score", delta: 8, unit: "pts" }],
    impact_note: "",
  },
  confidence: { stars: 3, label: "Media" },
});

export const INSIGHTS = {
  insights: [
    insight("a", "risk", "Cumplimiento por debajo del objetivo"),
    insight("b", "positive", "Buen control de comentarios"),
  ],
  prioritized: {
    top: [insight("a", "risk", "Cumplimiento por debajo del objetivo")],
    additional: [],
  },
  relations: [],
  personal_benchmark: {
    current: 72.5,
    average: 70,
    best_ever: { score: 80, period: "2026-09" },
    best_week: null,
    last_4_weeks: 71,
    last_3_months: null,
    percentile: 60,
    narrative: "Por encima de su promedio histórico.",
    observations: 4,
    confidence: { stars: 3, label: "Media" },
  },
  reevaluations: [],
  performance_trend_explained: {
    available: false,
    direction: "estable",
    score_delta: 0,
    bullets: [],
    reason: "Sin historial.",
  },
  engine_version: "1.5.0",
  insights_engine_version: "1.0.0",
  last_updated: "2026-11-05T17:23:53Z",
};

export const EQUILIBRIO = {
  health_score: BUNDLE.health_score,
  dimensiones: [
    {
      ...factor("Cumplimiento", "75%", 25, 18.75),
      normalized_value: 75,
      explicacion: "Cumplimiento aceptable.",
    },
  ],
  estado: {
    estado: "Riesgo Operativo",
    color: "orange",
    emoji: "",
    rango: "40–59",
    explicacion_ejecutiva: "Es conveniente intervenir.",
  },
  escala: [
    {
      min: 90,
      estado: "Equilibrio Óptimo",
      color: "green",
      emoji: "",
      rango: "90–100",
      explicacion_ejecutiva: "Puede asumir nuevos desafíos.",
    },
    {
      min: 40,
      estado: "Riesgo Operativo",
      color: "orange",
      emoji: "",
      rango: "40–59",
      explicacion_ejecutiva: "Es conveniente intervenir.",
    },
  ],
  trend: {
    available: false,
    direction: "estable",
    score_delta: 0,
    bullets: [],
    reason: "Sin historial suficiente para explicar la tendencia.",
  },
  meaning: "Hay señales de desequilibrio operativo.",
  impact: "No se recomienda incrementar responsabilidades.",
  strengths: [],
  weaknesses: [],
  recommendations: [],
  confidence: { data_quality_pct: 90, reliability_pct: 50 },
  calidad: {
    engine_version: "1.5.0",
    formula_set_version: "4.4",
    insights_engine_version: "1.0.0",
    fecha: "2026-11-05T17:24:01Z",
    origen: "Tareas del mes en curso",
    cache_active: false,
    tiempo_calculo_ms: 968,
    registros_utilizados: { semanas_consistencia: 0, dias_consistencia: 0 },
    registros_descartados: [],
    advertencias: [],
  },
};

const metricaPersonal = (value) => ({
  mode: "personal",
  value,
  best_ever: value,
  best_ever_diff: 0,
  avg_last_90_days: value,
  avg_last_90_days_diff: 0,
  semana_anterior: null,
  semana_anterior_diff: null,
  mes_anterior: null,
  mes_anterior_diff: null,
  target: null,
  target_gap: null,
  note: null,
});

export const REFERENCIA = {
  benchmark: {
    mode: "personal",
    performance: metricaPersonal(72.5),
    operational_risk: metricaPersonal(20),
    cumplimiento: metricaPersonal(75),
    carga_laboral: metricaPersonal(22),
    capacidad_futura: metricaPersonal(98),
    role_target: null,
    explain: {
      mode: "personal",
      reason: "No existen otros colaboradores con el mismo cargo.",
      peer_count: 0,
      period_analyzed: "Hasta 366 días de historial personal",
      data_available: "Historial personal",
    },
    engine_version: "1.5.0",
  },
  evolution: { available: false },
  confidence: { data_quality_pct: 90, reliability_pct: 52 },
  last_updated: "2026-11-05T17:24:03Z",
};

export const RIESGO = {
  score: 64,
  classification: "Alto",
  classification_color: "orange",
  factors: [
    {
      name: "Sobrecarga proyectada",
      weight: 22,
      points: 15.4,
      detail: "Sobrecarga del 120 %",
    },
    { name: "Horas extra", weight: 12, points: 0, detail: "Sin horas extra" },
  ],
  trend_vs_prev_month: { available: true, diff: 8 },
  suggested_actions: [
    "Redistribuir tareas pendientes para evitar la sobrecarga proyectada.",
  ],
  engine_version: "1.5.0",
  explain: {
    formula: "Σ (severidad × peso)",
    steps: ["+15.4 Sobrecarga proyectada"],
  },
  confidence: { data_quality_pct: 90, reliability_pct: 50 },
  trend_explained: {
    available: false,
    direction: "estable",
    score_delta: 0,
    bullets: [],
  },
  last_updated: "2026-11-05T17:24:08Z",
};

export const RIESGO_EQUIPO = {
  members: [
    { id: 2, name: "Luis", role: "ANALISTA_CC", ...RIESGO },
    {
      id: 3,
      name: "Sofía",
      role: "ASISTENTE_GH",
      ...RIESGO,
      score: 12,
      classification: "Bajo",
    },
  ],
  summary: { bajo: 1, medio: 0, alto: 1, critico: 0 },
  engine_version: "1.5.0",
  last_updated: "2026-11-05T17:24:10Z",
};

export const EQUIPO = {
  users: [
    {
      id: 2,
      name: "Luis",
      role: "ANALISTA_CC",
      score: 58,
      completed_pct: 50,
      carga_ratio: 120,
      total_tasks: 4,
      overdue_count: 1,
      color: "red",
      carga_pct: 115,
      carga_color: "red",
      carga_label: "Sobrecarga",
      carga_real_hours: 161,
      carga_base_hours: 140,
      capacidad_disponible_pct: 0,
      horas_disponibles: 0,
    },
    {
      id: 3,
      name: "Sofía",
      role: "ASISTENTE_GH",
      score: 85,
      completed_pct: 90,
      carga_ratio: 100,
      total_tasks: 10,
      overdue_count: 0,
      color: "green",
      carga_pct: 100,
      carga_color: "green",
      carga_label: "Óptimo",
      carga_real_hours: 140,
      carga_base_hours: 140,
      capacidad_disponible_pct: 5,
      horas_disponibles: 7,
    },
  ],
};

export const CAPACIDAD = {
  members: [
    {
      id: 3,
      name: "Sofía",
      role: "ASISTENTE_GH",
      user_id: 3,
      horas_restantes_hoy: 2,
      dias_laborables_restantes: 12,
      base_futura_total: 80,
      comprometido_en_progreso: 10,
      comprometido_pendiente: 20,
      comprometido_futuro: 30,
      disponible: 50,
      disponible_pct: 62,
      estado: "alta",
      estado_color: "green",
      estado_label: "Puede asumir proyectos",
      tasks_sin_estimar: 0,
      confiabilidad: {
        pct: 100,
        holidays_configured: true,
        tasks_without_estimate: 0,
      },
    },
  ],
  summary: {
    total: 1,
    alta: 1,
    limitada: 0,
    sobrecargados: 0,
    sin_planificacion: 0,
  },
};

export const RECOMENDACIONES = {
  recommendations: [],
  prioritized: {
    top: [
      {
        id: 2,
        priority: "alta",
        priority_color: "red",
        text: "Redistribuir 12 h de Luis hacia Sofía.",
        impact_score_pts: 6,
        impact_risk_pts: -10,
        affected_count: 2,
        ease_rank: 1,
        has_candidate: true,
      },
    ],
    additional: [],
  },
  engine_version: "1.5.0",
  last_updated: "2026-11-05T17:24:10Z",
};

export const EJECUTIVO = {
  month: "2026-11",
  overview: {
    avg_cumplimiento: 70,
    avg_cumplimiento_color: "yellow",
    sobrecarga_count: 1,
    subutilizacion_count: 0,
    total_horas: 301,
    total_consultas: 12,
  },
  trend: [
    { month: "2026-10", label: "oct. 26", avg_cumplimiento: 74 },
    { month: "2026-11", label: "nov. 26", avg_cumplimiento: 70 },
  ],
  trend_delta: -4,
  alerts: {
    low_cumplimiento: [
      { type: "cumplimiento", user_id: 2, name: "Luis", value: 50 },
    ],
    sobrecarga: [{ type: "sobrecarga", user_id: 2, name: "Luis", value: 115 }],
    pending_ideas: [],
  },
  ranking: [
    {
      id: 3,
      name: "Sofía",
      role: "ASISTENTE_GH",
      score: 85,
      score_trend: 5,
      completed_pct: 90,
      carga_pct: 100,
      carga_real_hours: 140,
      carga_base_hours: 140,
      carga_color: "green",
      carga_label: "Óptimo",
      total_tasks: 10,
    },
    {
      id: 2,
      name: "Luis",
      role: "ANALISTA_CC",
      score: 58,
      score_trend: -6,
      completed_pct: 50,
      carga_pct: 115,
      carga_real_hours: 161,
      carga_base_hours: 140,
      carga_color: "red",
      carga_label: "Sobrecarga",
      total_tasks: 4,
    },
  ],
  workload: [
    { id: 3, name: "Sofía", real_hours: 140, base_hours: 140, color: "green" },
    { id: 2, name: "Luis", real_hours: 161, base_hours: 140, color: "red" },
  ],
  ceo: {
    estado: "yellow",
    estado_label: "Atención",
    cambios: [{ text: "Luis quedó sobrecargado/a", positive: false }],
    atender: ["Luis — sobrecarga proyectada (115%)"],
    performance: { avg: 71.5, classification: "Riesgo", color: "yellow" },
    operational_risk: { avg: 38, classification: "Medio", color: "yellow" },
  },
};

const prediccion = (extra) => ({
  available: true,
  horizon: 30,
  confidence_pct: 71,
  historical_reliability: "media",
  historical_window_weeks: 3,
  que_ocurrira: "Lo que ocurrirá.",
  por_que: "Por qué.",
  datos_utilizados: ["Historial semanal"],
  variables_con_mayor_impacto: ["Ritmo de cumplimiento"],
  que_hacer: ["Mantener el ritmo actual."],
  ...extra,
});

export const PREDICCIONES = {
  cumplimiento: prediccion({
    cumplimiento_esperado_cierre_pct: 78,
    variacion_esperada_pct: 3,
    que_ocurrira: "El cumplimiento esperado al cierre del mes es 78 %.",
  }),
  sobrecarga: prediccion({
    probabilidad_pct: 10,
    nivel: "Bajo",
    que_ocurrira: "Probabilidad de sobrecarga operativa: 10 % (nivel Bajo).",
  }),
  estabilidad: {
    classification: "Muy Alta",
    average_coefficient_of_variation: 0,
    based_on: [],
  },
  task_delays: [
    {
      task_id: 7,
      title: "Informe de clima laboral",
      prediction: prediccion({
        horizon: 7,
        probabilidad_pct: 65,
        nivel: "Alto",
        motivos: ["Capacidad baja"],
      }),
    },
  ],
};

export const TENDENCIAS = {
  user_id: 1,
  window_weeks: 3,
  indicators: {
    cumplimiento: {
      indicator: "cumplimiento",
      label: "Cumplimiento",
      available: true,
      direction: "negativa",
      slope: -2,
      coefficient_of_variation: 12,
      data_points: [
        { label: "Sem 1", value: 80 },
        { label: "Sem 2", value: 75 },
      ],
    },
    consistencia_operativa: {
      indicator: "consistencia_operativa",
      label: "Consistencia Operativa",
      available: false,
      reason: "Historial insuficiente",
      direction: "estable",
      slope: 0,
      coefficient_of_variation: 0,
      data_points: [],
    },
  },
  engine_version: "1.0.0",
  generated_at: "2026-11-05T17:24:12Z",
};

export const CONFIGURACION = {
  config: {
    health_weight_cumplimiento: 25,
    health_weight_carga: 25,
    health_weight_vencidas: 20,
    health_weight_consistencia: 15,
    health_weight_capacidad: 15,
    perf_weight_cumplimiento: 35,
    perf_weight_vencidas: 25,
    perf_weight_consistencia: 25,
    perf_weight_trazabilidad: 15,
    risk_weight_sobrecarga: 22,
    risk_weight_vencidas_criticas: 18,
    risk_weight_tendencia_negativa: 15,
    risk_weight_horas_extra: 12,
    risk_weight_baja_capacidad: 11,
    risk_weight_variabilidad: 10,
    risk_weight_concentracion: 7,
    risk_weight_sin_planificacion: 5,
    risk_threshold_medio: 31,
    risk_threshold_alto: 61,
    risk_threshold_critico: 81,
    alert_overdue_task_threshold: 3,
    alert_consecutive_overload_days: 3,
    anomaly_variation_threshold_pct: 30,
    cache_ttl_minutes: 15,
    prediction_min_weeks_media: 2,
    prediction_min_weeks_alta: 4,
  },
  prediction_max_days: 30,
};
CONFIGURACION.defaults = { ...CONFIGURACION.config };

export function errorApi(status, message, code = "error", details = null) {
  const err = new Error(message);
  err.response = { status, data: { error: { code, message, details } } };
  return err;
}

export function servicioFalso() {
  return {
    yo: vi.fn().mockResolvedValue(ME),
    misKpi: vi.fn().mockResolvedValue(kpi()),
    misKpiPorRango: vi.fn(),
    kpiDe: vi
      .fn()
      .mockResolvedValue(
        kpi({ user: { id: 2, name: "Luis", role: "ANALISTA_CC" } }),
      ),
    equipo: vi.fn().mockResolvedValue(EQUIPO),
    capacidadDelEquipo: vi.fn().mockResolvedValue(CAPACIDAD),
    ejecutivo: vi.fn().mockResolvedValue(EJECUTIVO),
    analisis: vi.fn().mockResolvedValue(BUNDLE),
    insights: vi.fn().mockResolvedValue(INSIGHTS),
    equilibrio: vi.fn().mockResolvedValue(EQUILIBRIO),
    referencia: vi.fn().mockResolvedValue(REFERENCIA),
    historial: vi
      .fn()
      .mockResolvedValue({ kind: "performance_score", months: 3, points: [] }),
    precisionTiempoObjetivo: vi.fn().mockResolvedValue({
      available: false,
      reason: "Sin tareas completadas con horas reales registradas este mes.",
    }),
    calidadDelDato: vi.fn().mockResolvedValue({ pct: 100, issues: [] }),
    simular: vi.fn(),
    riesgo: vi.fn().mockResolvedValue(RIESGO),
    riesgoDelEquipo: vi.fn().mockResolvedValue(RIESGO_EQUIPO),
    recomendacionesDelEquipo: vi.fn().mockResolvedValue(RECOMENDACIONES),
    predicciones: vi.fn().mockResolvedValue(PREDICCIONES),
    tendencias: vi.fn().mockResolvedValue(TENDENCIAS),
    alertasPreventivas: vi.fn().mockResolvedValue({
      alerts: [
        {
          severity: "amarilla",
          message: "Presenta una proyección de subutilización de capacidad.",
          source: "Predicción de Subutilización",
          related_indicator: "subutilizacion",
        },
      ],
    }),
    alertasDelEquipo: vi.fn().mockResolvedValue({
      alerts: [
        {
          severity: "verde",
          message: "Sin riesgos preventivos detectados en el equipo.",
          source: "Inteligencia Preventiva",
          related_indicator: "estabilidad",
        },
      ],
    }),
    subutilizacionDelEquipo: vi.fn().mockResolvedValue({
      members: [
        {
          user_id: 2,
          name: "Luis",
          prediction: { ...prediccion({ nivel: "Medio" }) },
        },
      ],
    }),
    retrasoDeProyecto: vi.fn().mockResolvedValue(
      prediccion({
        probabilidad_pct: 40,
        nivel: "Medio",
        motivos: ["Horas atrasadas"],
      }),
    ),
    simularTiempoObjetivo: vi.fn(),
    simularRedistribucion: vi.fn(),
    simularParticipantes: vi.fn(),
    configuracion: vi.fn().mockResolvedValue(CONFIGURACION),
    guardarConfiguracion: vi.fn(),
    limitesDeCarga: vi.fn().mockResolvedValue({
      workload_limit_low: 5.5,
      workload_limit_high: 7.5,
      workload_limit_overload: 8.5,
      hours_per_day: 6.5,
      monthly_expected_hours: 140,
    }),
    guardarLimitesDeCarga: vi.fn(),
    ventanaDePrediccion: vi
      .fn()
      .mockResolvedValue({ window_weeks: "3", options: ["3", "4", "8"] }),
    guardarVentanaDePrediccion: vi.fn(),
    curvas: vi.fn().mockResolvedValue({ curves: {}, defaults: {} }),
    guardarCurva: vi.fn(),
    objetivosPorRol: vi
      .fn()
      .mockResolvedValue({ targets: {}, roles: [], role_labels: {} }),
    guardarObjetivoDeRol: vi.fn(),
    compatibilidad: vi.fn().mockResolvedValue({
      matrix: {},
      roles: [],
      role_labels: {},
      role_levels: {},
    }),
    guardarCompatibilidad: vi.fn(),
    fechasDeInicio: vi.fn().mockResolvedValue([]),
    guardarFechaDeInicio: vi.fn(),
  };
}
