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
    return apiClient
      .patch(`${POLITICAS}${id}/`, payload)
      .then((res) => res.data);
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
    return apiClient
      .get(`${POLITICAS}sugerencias/`, { params })
      .then((res) => res.data);
  },
  reevaluar() {
    return apiClient.post(`${POLITICAS}reevaluar/`).then((res) => res.data);
  },
};

const DEPRECIACION = `${POLITICAS}depreciacion/`;

/**
 * En cuánto tiempo pierde su valor cada tipo de equipo (§22.3).
 *
 * No tiene «reevaluar» como las de renovación: la depreciación se calcula al
 * leer y no se guarda en ninguna columna, así que un cambio se ve en la
 * siguiente consulta sin recorrer el parque.
 */
export const depreciacionService = {
  list(params = {}) {
    return apiClient.get(DEPRECIACION, { params }).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(DEPRECIACION, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${DEPRECIACION}${id}/`, payload)
      .then((res) => res.data);
  },
  remove(id) {
    return apiClient.delete(`${DEPRECIACION}${id}/`).then((res) => res.data);
  },
};
