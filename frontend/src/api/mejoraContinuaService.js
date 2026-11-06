import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/mejora-continua";

const datos = (r) => r.data;

/**
 * El error de una llamada de Mejora continua, en el contrato uniforme
 * `{"error": {"code", "message", "details"}}` (el mismo de Tareas). La
 * pantalla decide por `codigo` (`validation_error`, `permission_denied`,
 * `not_found`, `invalid_transition`, `conflict`) o `estado`, nunca por el
 * texto; `campos` trae el primer mensaje de cada campo con error.
 */
export function errorDeMejora(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  return errorDeTareas(err, porDefecto);
}

/**
 * Mejora continua de Gestión Humana (ideas de mejora de procesos, portado de
 * Nexo). Contrato: `/api/v1/mejora-continua/`. El servidor vuelve a autorizar
 * cada petición (`mejora_continua.*` y el organigrama: una idea que no se ve
 * es 404). Ocultar un botón aquí nunca es la barrera.
 */
export const mejoraContinuaService = {
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),

  /** `soloMias`: la pestaña «Mis ideas» (`mine=1`). */
  listar: ({ soloMias = false } = {}) =>
    apiClient
      .get(`${BASE}/ideas/`, { params: soloMias ? { mine: 1 } : {} })
      .then(datos),

  obtener: (id) => apiClient.get(`${BASE}/ideas/${id}/`).then(datos),

  /** Siempre multipart: con o sin adjunto, el servidor lo acepta igual. */
  proponer: ({ title, description, impact, archivo }) => {
    const formulario = new FormData();
    formulario.append("title", title);
    formulario.append("description", description);
    formulario.append("impact", impact);
    if (archivo) formulario.append("attachment", archivo);
    return apiClient.post(`${BASE}/ideas/`, formulario).then(datos);
  },

  actualizarAvance: (id, progress) =>
    apiClient.patch(`${BASE}/ideas/${id}/`, { progress }).then(datos),

  /** Mueve de etapa. `expected_status` va siempre: si otra persona ya la
   * movió, el servidor responde 409 en vez de moverla dos veces. */
  cambiarEtapa: (id, { action, comment, expectedStatus }) =>
    apiClient
      .post(`${BASE}/ideas/${id}/status/`, {
        action,
        comment: comment || null,
        expected_status: expectedStatus,
      })
      .then(datos),

  /** Votar (`PUT`) y quitar el voto (`DELETE`) son idempotentes: un doble
   * clic no deshace lo hecho. Responden `{ vote_count, voted_by_me }`. */
  votar: (id) => apiClient.put(`${BASE}/ideas/${id}/vote/`).then(datos),
  quitarVoto: (id) => apiClient.delete(`${BASE}/ideas/${id}/vote/`).then(datos),
};
