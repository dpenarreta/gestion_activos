import { apiClient } from "./client";

const DEPARTAMENTOS = "/organizacion/departamentos/";
const EMPLEADOS = "/organizacion/empleados/";
const SEDES = "/organizacion/sedes/";
const PROVEEDORES = "/organizacion/proveedores/";

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

/**
 * A quién se le compra: equipos y piezas de repuesto.
 *
 * Era un texto dentro de cada activo y no existía para los repuestos. Como
 * texto libre, «Tecnomega», «TECNOMEGA» y «Tecno Mega» son la misma empresa
 * para una persona y tres para una consulta: preguntar cuánto se le lleva
 * comprado —o a quién reclamarle una pieza que falló— devuelve un tercio de lo
 * que hay y nadie nota lo que falta.
 */
export const proveedoresService = {
  list(params = {}) {
    return apiClient.get(PROVEEDORES, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${PROVEEDORES}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(PROVEEDORES, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${PROVEEDORES}${id}/`, payload)
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
