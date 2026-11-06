import { descargarBlob } from "../utils/descargas";
import { apiClient } from "./client";
import { nombreDeArchivo } from "./kpiService";
import { errorDeTareas } from "./tareasService";

const BASE = "/informes";

const datos = (r) => r.data;

/** Quita lo vacío de una query: el servidor toma la ausencia como «sin
 * filtro» y una cadena vacía la tendría que validar. */
function limpio(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, valor]) =>
        valor !== undefined &&
        valor !== null &&
        valor !== "" &&
        !(Array.isArray(valor) && valor.length === 0),
    ),
  );
}

/** El roster recibe sus filtros como listas separadas por coma (CSV). */
function csv(lista) {
  return Array.isArray(lista) && lista.length ? lista.join(",") : undefined;
}

/**
 * El error de una llamada de Informes, en el contrato uniforme `{"error":
 * {"code", "message", "details"}}` (el mismo de Tareas, KPI y Proyectos). La
 * pantalla decide por `codigo` (`roster_vacio`, `generacion_fallida`,
 * `not_found`…) o `estado`, nunca por el texto; `campos` trae el primer
 * mensaje de cada campo con error.
 */
export function errorDeInformes(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  return errorDeTareas(err, porDefecto);
}

/**
 * Informes ejecutivos de Gestión Humana (fase 2c, portado de Nexo).
 * Contrato: `/api/v1/informes/`. El servidor genera, congela y vuelve a
 * autorizar cada petición (`informes_gh.ver`, `.generar`, `.administrar`, y
 * el ámbito por el organigrama: un informe ajeno es 404). Ocultar un botón
 * aquí nunca es la barrera.
 */
export const informesService = {
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),

  /** A quiénes incluiría un informe con esos filtros (listas de códigos de
   * rol e ids de unidades y de cuentas). */
  roster: ({ roles, areas, colaboradores } = {}) =>
    apiClient
      .get(`${BASE}/roster/`, {
        params: limpio({
          roles: csv(roles),
          areas: csv(areas),
          colaboradores: csv(colaboradores),
        }),
      })
      .then(datos),

  /** Si el mes tiene cierre y con qué fecha de corte. `mes`: «AAAA-MM». */
  estadoDeCierre: (mes) => {
    const [year, month] = String(mes).split("-").map(Number);
    return apiClient
      .get(`${BASE}/executive/closure-status/`, { params: { year, month } })
      .then(datos);
  },

  /** Genera el informe. Devuelve `{ informe, nuevo }`: `nuevo` es falso si
   * el servidor devolvió el mismo informe pedido hace menos de 30 s (200). */
  generar: (pedido) =>
    apiClient
      .post(`${BASE}/executive/`, pedido)
      .then((r) => ({ informe: r.data, nuevo: r.status !== 200 })),

  listar: ({ page = 1, pageSize = 20, tipo, estado } = {}) =>
    apiClient
      .get(`${BASE}/executive/list/`, {
        params: limpio({ page, page_size: pageSize, tipo, estado }),
      })
      .then(datos),

  obtener: (reportId) =>
    apiClient
      .get(`${BASE}/executive/${encodeURIComponent(reportId)}/`)
      .then(datos),

  /** Descarga el Excel con la sesión (blob) y lo guarda con
   * `descargarBlob`, que deja el registro de descargas. */
  exportarExcel: async (reportId) => {
    const r = await apiClient.get(
      `${BASE}/executive/${encodeURIComponent(reportId)}/export/`,
      { responseType: "blob" },
    );
    const nombre = nombreDeArchivo(
      r.headers?.["content-disposition"],
      `${reportId}.xlsx`,
    );
    descargarBlob(r.data, nombre);
    return nombre;
  },

  /** El navegador imprime el PDF: el servidor no lo ve, así que se avisa
   * para la bitácora. */
  registrarPdf: (reportId) =>
    apiClient
      .post(`${BASE}/executive/${encodeURIComponent(reportId)}/eventos/`, {
        action: "exported_pdf",
      })
      .then(datos),

  // --- Solo `informes_gh.administrar` ---
  bitacora: (reportId) =>
    apiClient
      .get(`${BASE}/executive/${encodeURIComponent(reportId)}/audit/`)
      .then(datos),
  incidentes: ({ page = 1, pageSize = 20, reportId } = {}) =>
    apiClient
      .get(`${BASE}/executive/integrity-incidents/`, {
        params: limpio({ page, page_size: pageSize, report_id: reportId }),
      })
      .then(datos),
};
