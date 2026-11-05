import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/analytics";

const datos = (r) => r.data;

function limpio(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, valor]) => valor !== undefined && valor !== null && valor !== "",
    ),
  );
}

/**
 * El error de una llamada del motor de KPI (contrato uniforme `{"error":
 * {"code", "message", "details"}}`, el mismo de Tareas). La pantalla decide
 * por `estado` o `codigo`, nunca por el texto.
 */
export function errorDeKpi(err, porDefecto = "No se pudo cargar.") {
  return errorDeTareas(err, porDefecto);
}

/**
 * Motor de KPI: «Mis KPI», «KPI del equipo», «Resumen ejecutivo»,
 * «Inteligencia preventiva» y sus ajustes. Contrato: `/api/v1/analytics/`.
 * Todo lo calcula el servidor (sin IA) y vuelve a autorizar cada petición:
 * permisos `kpi.*` e `inteligencia_preventiva.ver`, y el ámbito por el
 * organigrama (403 si la persona no es de su equipo). Los simuladores nunca
 * guardan nada.
 */
export const kpiService = {
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),

  // --- KPI del mes ---
  misKpi: (mes) =>
    apiClient
      .get(`${BASE}/kpis/me/`, { params: limpio({ month: mes }) })
      .then(datos),
  misKpiPorRango: (desde, hasta) =>
    apiClient
      .get(`${BASE}/kpis/me/range/`, { params: { from: desde, to: hasta } })
      .then(datos),
  kpiDe: (usuarioId, mes) =>
    apiClient
      .get(`${BASE}/kpis/${usuarioId}/`, { params: limpio({ month: mes }) })
      .then(datos),
  equipo: (mes) =>
    apiClient
      .get(`${BASE}/kpis/team/`, { params: limpio({ month: mes }) })
      .then(datos),
  capacidadDelEquipo: () =>
    apiClient.get(`${BASE}/kpis/team-capacity/`).then(datos),
  ejecutivo: () => apiClient.get(`${BASE}/kpis/executive/`).then(datos),

  // --- Análisis de una persona ---
  analisis: (usuarioId) => apiClient.get(`${BASE}/${usuarioId}/`).then(datos),
  insights: (usuarioId) =>
    apiClient.get(`${BASE}/insights/${usuarioId}/`).then(datos),
  equilibrio: (usuarioId) =>
    apiClient.get(`${BASE}/equilibrio/${usuarioId}/`).then(datos),
  referencia: (usuarioId) =>
    apiClient.get(`${BASE}/benchmarks/${usuarioId}/`).then(datos),
  historial: (usuarioId, tipo, meses) =>
    apiClient
      .get(`${BASE}/history/${usuarioId}/`, {
        params: { kind: tipo, months: meses },
      })
      .then(datos),
  precisionTiempoObjetivo: (usuarioId) =>
    apiClient.get(`${BASE}/target-time/${usuarioId}/`).then(datos),
  calidadDelDato: (alcance) =>
    apiClient
      .get(`${BASE}/data-quality/`, { params: limpio({ scope: alcance }) })
      .then(datos),
  /** «¿Qué pasaría si…?»: nunca guarda nada. */
  simular: (usuarioId, escenario) =>
    apiClient.post(`${BASE}/simulate/${usuarioId}/`, escenario).then(datos),

  // --- Riesgo operativo y recomendaciones (inteligencia_preventiva.ver) ---
  riesgo: (usuarioId) =>
    apiClient.get(`${BASE}/operational-risk/${usuarioId}/`).then(datos),
  riesgoDelEquipo: () =>
    apiClient.get(`${BASE}/operational-risk/team/`).then(datos),
  recomendacionesDelEquipo: () =>
    apiClient.get(`${BASE}/recommendations/team/`).then(datos),

  // --- Inteligencia preventiva ---
  predicciones: (usuarioId) =>
    apiClient.get(`${BASE}/predictive/predictions/${usuarioId}/`).then(datos),
  tendencias: (usuarioId, semanas) =>
    apiClient
      .get(`${BASE}/predictive/trend/${usuarioId}/`, {
        params: limpio({ weeks_back: semanas }),
      })
      .then(datos),
  alertasPreventivas: (usuarioId) =>
    apiClient.get(`${BASE}/predictive/alerts/${usuarioId}/`).then(datos),
  alertasDelEquipo: () =>
    apiClient.get(`${BASE}/predictive/team-alerts/`).then(datos),
  subutilizacionDelEquipo: () =>
    apiClient.get(`${BASE}/predictive/team-subutilization/`).then(datos),
  retrasoDeProyecto: (proyectoId) =>
    apiClient
      .get(`${BASE}/predictive/project-delay/${proyectoId}/`)
      .then(datos),
  simularTiempoObjetivo: (usuarioId, valores) =>
    apiClient
      .post(`${BASE}/predictive/simulate/${usuarioId}/`, valores)
      .then(datos),
  simularRedistribucion: (valores) =>
    apiClient
      .post(`${BASE}/predictive/simulate/redistribute/`, valores)
      .then(datos),
  simularParticipantes: (proyectoId, valores) =>
    apiClient
      .post(`${BASE}/predictive/simulate/project/${proyectoId}/`, valores)
      .then(datos),

  // --- Ajustes del motor (leer: kpi.acceder; cambiar: kpi.administrar) ---
  configuracion: () =>
    apiClient.get(`${BASE}/settings/analytics-config/`).then(datos),
  guardarConfiguracion: (cambios) =>
    apiClient.patch(`${BASE}/settings/analytics-config/`, cambios).then(datos),
  limitesDeCarga: () =>
    apiClient.get(`${BASE}/settings/workload-config/`).then(datos),
  guardarLimitesDeCarga: (valores) =>
    apiClient.put(`${BASE}/settings/workload-config/`, valores).then(datos),
  ventanaDePrediccion: () =>
    apiClient.get(`${BASE}/settings/prediction-window/`).then(datos),
  guardarVentanaDePrediccion: (semanas) =>
    apiClient
      .put(`${BASE}/settings/prediction-window/`, { window_weeks: semanas })
      .then(datos),
  curvas: () =>
    apiClient.get(`${BASE}/settings/normalization-curves/`).then(datos),
  guardarCurva: (nombre, puntos) =>
    apiClient
      .patch(`${BASE}/settings/normalization-curves/`, {
        name: nombre,
        points: puntos,
      })
      .then(datos),
  objetivosPorRol: () =>
    apiClient.get(`${BASE}/settings/role-targets/`).then(datos),
  guardarObjetivoDeRol: (rol, objetivo) =>
    apiClient
      .patch(`${BASE}/settings/role-targets/`, { role: rol, target: objetivo })
      .then(datos),
  compatibilidad: () =>
    apiClient.get(`${BASE}/settings/role-compatibility/`).then(datos),
  guardarCompatibilidad: (rol, compatibles) =>
    apiClient
      .patch(`${BASE}/settings/role-compatibility/`, {
        role: rol,
        compatible_roles: compatibles,
      })
      .then(datos),
  fechasDeInicio: () =>
    apiClient.get(`${BASE}/settings/kpi-start-date/`).then(datos),
  guardarFechaDeInicio: (usuarioId, fecha) =>
    apiClient
      .patch(`${BASE}/settings/kpi-start-date/`, {
        user_id: usuarioId,
        kpi_start_date: fecha || null,
      })
      .then(datos),
};
