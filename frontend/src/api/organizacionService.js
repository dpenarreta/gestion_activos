import { apiClient } from "./client";

const DEPARTAMENTOS = "/organizacion/departamentos/";
const EMPLEADOS = "/organizacion/empleados/";
const UBICACIONES = "/organizacion/ubicaciones/";

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
    return apiClient
      .patch(`${DEPARTAMENTOS}${id}/`, payload)
      .then((res) => res.data);
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
    return apiClient
      .patch(`${EMPLEADOS}${id}/`, payload)
      .then((res) => res.data);
  },
};

/**
 * Catálogo de lugares físicos (§4.1).
 *
 * Es un catálogo y no texto libre porque «Bodega TI», «bodega de TI» y
 * «Bodega  TI» son el mismo sitio para una persona y tres para una consulta:
 * con texto libre, filtrar el inventario por ubicación devuelve un tercio de
 * los equipos que están ahí y nadie nota lo que falta.
 */
export const ubicacionesService = {
  list(params = {}) {
    return apiClient.get(UBICACIONES, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${UBICACIONES}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(UBICACIONES, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${UBICACIONES}${id}/`, payload)
      .then((res) => res.data);
  },
};
