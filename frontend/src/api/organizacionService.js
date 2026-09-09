import { apiClient } from "./client";

const DEPARTAMENTOS = "/organizacion/departamentos/";
const EMPLEADOS = "/organizacion/empleados/";
const SEDES = "/organizacion/sedes/";

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
 * Catálogo de edificios, locales o ciudades.
 *
 * La sede era un texto dentro de cada ubicación, y ahí el problema no se veía
 * hasta que el inventario crecía: «Sede Quito Norte», «sede quito norte» y
 * «Quito Norte» son el mismo edificio para una persona y tres para el
 * desplegable del traslado, que queda partido en listas incompletas sin que
 * nadie pueda notarlo desde la pantalla.
 */
export const sedesService = {
  list(params = {}) {
    return apiClient.get(SEDES, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${SEDES}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(SEDES, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${SEDES}${id}/`, payload).then((res) => res.data);
  },
};
