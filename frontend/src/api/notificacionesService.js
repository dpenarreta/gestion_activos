import { apiClient } from "./client";

const BASE = "/notificaciones";

/** La campana: cada quien ve y marca solo sus propias notificaciones. */
export const notificacionesService = {
  /** El contador de no leídas y las más recientes. */
  resumen() {
    return apiClient.get(`${BASE}/resumen/`).then((r) => r.data);
  },
  /** El historial, paginado; filtros `modulo` y `estado=no_leidas`. */
  listar(params = {}) {
    return apiClient.get(`${BASE}/`, { params }).then((r) => r.data);
  },
  modulos() {
    return apiClient.get(`${BASE}/modulos/`).then((r) => r.data);
  },
  leer(id) {
    return apiClient.post(`${BASE}/${id}/leer/`).then((r) => r.data);
  },
  leerTodas() {
    return apiClient.post(`${BASE}/leer-todas/`).then((r) => r.data);
  },
};
