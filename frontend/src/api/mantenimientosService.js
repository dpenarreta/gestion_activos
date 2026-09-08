import { apiClient } from "./client";

const MANTENIMIENTOS = "/mantenimientos/";
const COMPONENTES = "/mantenimientos/componentes/";

export const mantenimientosService = {
  list(params = {}) {
    return apiClient.get(MANTENIMIENTOS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${MANTENIMIENTOS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(MANTENIMIENTOS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${MANTENIMIENTOS}${id}/`, payload).then((res) => res.data);
  },
  remove(id) {
    return apiClient.delete(`${MANTENIMIENTOS}${id}/`).then((res) => res.data);
  },
};

export const componentesService = {
  list(params = {}) {
    return apiClient.get(COMPONENTES, { params }).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(COMPONENTES, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${COMPONENTES}${id}/`, payload).then((res) => res.data);
  },
};
