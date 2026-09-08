import { apiClient } from "./client";

const POLITICAS = "/politicas/";

export const politicasService = {
  list(params = {}) {
    return apiClient.get(POLITICAS, { params }).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(POLITICAS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${POLITICAS}${id}/`, payload).then((res) => res.data);
  },
  remove(id) {
    return apiClient.delete(`${POLITICAS}${id}/`).then((res) => res.data);
  },

  /**
   * Activos que hoy exceden algún umbral (RF-07).
   *
   * El backend recalcula en vivo en vez de leer la columna cacheada, porque
   * el criterio de longevidad se cumple por el paso del tiempo: un equipo que
   * nadie tocó puede haber cruzado su vida útil desde la última evaluación.
   */
  sugerencias(params) {
    return apiClient.get(`${POLITICAS}sugerencias/`, { params }).then((res) => res.data);
  },
  reevaluar() {
    return apiClient.post(`${POLITICAS}reevaluar/`).then((res) => res.data);
  },
};
