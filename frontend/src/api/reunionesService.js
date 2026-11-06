import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/reuniones";

const datos = (r) => r.data;

/**
 * El error de una llamada de Reuniones, en el contrato uniforme
 * `{"error": {"code", "message", "details"}}` (el mismo de Tareas). La
 * pantalla decide por `codigo` (`validation_error`, `permission_denied`,
 * `not_found`) o `estado`, nunca por el texto; `campos` trae el primer
 * mensaje de cada campo con error.
 */
export function errorDeReuniones(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  return errorDeTareas(err, porDefecto);
}

/**
 * Reuniones de Gestión Humana (portado de Nexo, sin Zoom: el enlace y la
 * clave los pega quien organiza). Contrato: `/api/v1/reuniones/`. El servidor
 * vuelve a autorizar cada petición (`reuniones.*`; una reunión que la persona
 * no ve es 404). Ocultar un botón aquí nunca es la barrera.
 */
export const reunionesService = {
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),

  /** A quién se puede invitar; `q` filtra por nombre o usuario. */
  invitables: (q = "") =>
    apiClient
      .get(`${BASE}/invitables/`, { params: q ? { q } : {} })
      .then(datos),

  /** `scope`: «» (las propias y a las que lo invitaron), `hosted` (las que
   * organiza) o `all` (todas, con `reuniones.administrar`). */
  listar: ({ scope = "", status = "", from = "", to = "" } = {}) => {
    const params = {};
    if (scope) params.scope = scope;
    if (status) params.status = status;
    if (from) params.from = from;
    if (to) params.to = to;
    return apiClient.get(`${BASE}/meetings/`, { params }).then(datos);
  },

  obtener: (id) => apiClient.get(`${BASE}/meetings/${id}/`).then(datos),

  crear: (reunion) => apiClient.post(`${BASE}/meetings/`, reunion).then(datos),

  /** Solo lo que cambia; `invitee_ids`, si va, es la lista completa. */
  editar: (id, cambios) =>
    apiClient.patch(`${BASE}/meetings/${id}/`, cambios).then(datos),

  eliminar: (id) => apiClient.delete(`${BASE}/meetings/${id}/`),

  /** `marcas`: `[{ user_id, attended }]`. Responde la reunión. */
  marcarAsistencia: (id, marcas) =>
    apiClient
      .post(`${BASE}/meetings/${id}/attendance/`, { attendance: marcas })
      .then(datos),
};
