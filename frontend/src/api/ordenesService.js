import { apiClient } from "./client";

const ORDENES = "/ordenes/";

/** Órdenes de trabajo: mantenimiento de sedes y agencias. */
export const ordenesService = {
  list(params = {}) {
    return apiClient.get(ORDENES, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${ORDENES}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(ORDENES, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${ORDENES}${id}/`, payload).then((res) => res.data);
  },
  asignar(id, payload) {
    return apiClient
      .post(`${ORDENES}${id}/asignar/`, payload)
      .then((res) => res.data);
  },
  /** Un paso del recorrido. `extra`: nota, fecha_programada, con_observaciones. */
  cambiarEstado(id, estado, extra = {}) {
    return apiClient
      .post(`${ORDENES}${id}/cambiar-estado/`, { estado, ...extra })
      .then((res) => res.data);
  },
  registrarMaterial(id, payload) {
    return apiClient
      .post(`${ORDENES}${id}/materiales/`, payload)
      .then((res) => res.data);
  },
  registrarManoDeObra(id, payload) {
    return apiClient
      .post(`${ORDENES}${id}/mano-de-obra/`, payload)
      .then((res) => res.data);
  },
  /** `tipo`: «materiales» o «mano-de-obra». */
  quitarCosto(id, tipo, filaId) {
    return apiClient
      .delete(`${ORDENES}${id}/costos/${tipo}/${filaId}/`)
      .then((res) => res.data);
  },
  resumen() {
    return apiClient.get(`${ORDENES}resumen/`).then((res) => res.data);
  },
  reportes(params = {}) {
    return apiClient
      .get(`${ORDENES}reportes/`, { params })
      .then((res) => res.data);
  },
  /** Descarga el archivo (Excel o PDF) con los filtros de la reportería. */
  exportar(params = {}) {
    return apiClient.get(`${ORDENES}exportar/`, {
      params,
      responseType: "blob",
    });
  },
  catalogos() {
    return apiClient.get(`${ORDENES}catalogos/`).then((res) => res.data);
  },
};
