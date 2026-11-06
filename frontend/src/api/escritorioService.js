import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/escritorio";

const datos = (r) => r.data;

/**
 * El error de una llamada del Escritorio, en el contrato uniforme
 * `{"error": {"code", "message", "details"}}`. La pantalla decide por
 * `codigo` (`validation_error`, `permission_denied`, `not_found`,
 * `conflict`) o `estado`, nunca por el texto; `campos` trae el primer mensaje
 * de cada campo con error.
 */
export function errorDeEscritorio(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  return errorDeTareas(err, porDefecto);
}

/** Solo los filtros con valor: el servidor toma un vacío como «inválido». */
function conValor(filtros) {
  return Object.fromEntries(
    Object.entries(filtros).filter(([, v]) => v !== "" && v != null),
  );
}

/**
 * Escritorio digital de Gestión Humana (notas entre personas y recordatorios
 * personales, portado de Nexo). Contrato: `/api/v1/escritorio/`. Lo ajeno
 * responde 404 y lo que es de la otra parte de una nota, 403: el servidor
 * vuelve a autorizar cada petición.
 */
export const escritorioService = {
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),
  hoy: () => apiClient.get(`${BASE}/today/`).then(datos),

  /** `q`, `priority`, `date` (AAAA-MM-DD), `sender`, `recipient`, `status`. */
  buscar: (filtros = {}) =>
    apiClient.get(`${BASE}/search/`, { params: conValor(filtros) }).then(datos),

  // --- Notas ---------------------------------------------------------------

  /** `view`: `desk`, `pinned`, `archive` o `sent`. */
  notas: (view = "desk") =>
    apiClient.get(`${BASE}/notes/`, { params: { view } }).then(datos),

  /** Siempre multipart: con o sin adjunto, el servidor lo acepta igual. */
  crearNota: ({ recipient, message, priority, color, archivo }) => {
    const formulario = new FormData();
    formulario.append("recipient", String(recipient));
    formulario.append("message", message);
    formulario.append("priority", priority);
    formulario.append("color", color);
    if (archivo) formulario.append("attachment", archivo);
    return apiClient.post(`${BASE}/notes/`, formulario).then(datos);
  },

  destinatarios: () => apiClient.get(`${BASE}/notes/recipients/`).then(datos),

  /** `{ unread }`: el globo del menú. */
  sinLeer: () => apiClient.get(`${BASE}/notes/unread-count/`).then(datos),

  obtenerNota: (id) => apiClient.get(`${BASE}/notes/${id}/`).then(datos),

  /** `action`: `read`, `pin`, `unpin`, `archive` o `unarchive` (del
   * destinatario). Responde la nota. */
  accionDeNota: (id, action) =>
    apiClient.patch(`${BASE}/notes/${id}/`, { action }).then(datos),

  /** El remitente la manda a la papelera; el destinatario la elimina si ya
   * está archivada (409 si no). */
  eliminarNota: (id) => apiClient.delete(`${BASE}/notes/${id}/`),

  respuestas: (id) => apiClient.get(`${BASE}/notes/${id}/replies/`).then(datos),

  /** 409 al pasar del tope de respuestas por nota. */
  responder: (id, message) =>
    apiClient.post(`${BASE}/notes/${id}/replies/`, { message }).then(datos),

  historialDeNota: (id) =>
    apiClient.get(`${BASE}/notes/${id}/history/`).then(datos),

  /** `{ due_at, title?, priority? }`; una vez (409). Responde
   * `{ reminder_id, reminder_title, reminder }`. */
  convertirEnRecordatorio: (id, datosDelRecordatorio) =>
    apiClient
      .post(`${BASE}/notes/${id}/convert-to-reminder/`, datosDelRecordatorio)
      .then(datos),

  // --- Recordatorios -------------------------------------------------------

  /** `archived` (true: los archivados), `status`, `from`, `to`. */
  recordatorios: ({ archived = false, status = "", from = "", to = "" } = {}) =>
    apiClient
      .get(`${BASE}/reminders/`, {
        params: conValor({
          archived: archived ? "true" : "",
          status,
          from,
          to,
        }),
      })
      .then(datos),

  crearRecordatorio: (recordatorio) =>
    apiClient.post(`${BASE}/reminders/`, recordatorio).then(datos),

  obtenerRecordatorio: (id) =>
    apiClient.get(`${BASE}/reminders/${id}/`).then(datos),

  /** Edición directa: `title`, `description`, `due_at`, `priority`, `repeat`. */
  editarRecordatorio: (id, cambios) =>
    apiClient.patch(`${BASE}/reminders/${id}/`, cambios).then(datos),

  /** `complete`, `postpone` (con `due_at`), `reopen` (`due_at` opcional),
   * `archive` o `unarchive`. Completar un completado o reabrir un pendiente
   * es 409. */
  accionDeRecordatorio: (id, action, dueAt = null) =>
    apiClient
      .patch(`${BASE}/reminders/${id}/`, {
        action,
        ...(dueAt ? { due_at: dueAt } : {}),
      })
      .then(datos),

  eliminarRecordatorio: (id) => apiClient.delete(`${BASE}/reminders/${id}/`),

  historialDeRecordatorio: (id) =>
    apiClient.get(`${BASE}/reminders/${id}/history/`).then(datos),

  /** `{ start_date, end_date, estimated_hours, title?, type?, frequency? }`;
   * pide `tareas.acceder` y una vez (409). Responde `{ task_id, task_title }`. */
  convertirEnTarea: (id, tarea) =>
    apiClient
      .post(`${BASE}/reminders/${id}/convert-to-task/`, tarea)
      .then(datos),
};
