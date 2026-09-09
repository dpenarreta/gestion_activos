import { apiClient } from "./client";

const DEPARTAMENTOS = "/organizacion/departamentos/";
const EMPLEADOS = "/organizacion/empleados/";
const UBICACIONES = "/organizacion/ubicaciones/";
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
