import { apiClient } from "./client";

const DEPARTAMENTOS = "/organizacion/departamentos/";
const EMPLEADOS = "/organizacion/empleados/";

export const departamentosService = {
  list(params = {}) {
    return apiClient.get(DEPARTAMENTOS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${DEPARTAMENTOS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(DEPARTAMENTOS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${DEPARTAMENTOS}${id}/`, payload).then((res) => res.data);
  },
};

export const empleadosService = {
  list(params = {}) {
    return apiClient.get(EMPLEADOS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${EMPLEADOS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(EMPLEADOS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${EMPLEADOS}${id}/`, payload).then((res) => res.data);
  },
};
