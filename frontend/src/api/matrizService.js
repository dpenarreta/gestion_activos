import { apiClient } from "./client";

const BASE = "/matriz";

/**
 * API del módulo Matriz de obligaciones (backend `apps.matriz`).
 *
 * Todo trabaja sobre la empresa activa —la cabecera `X-Empresa` que pone el
 * cliente—, como el resto del sistema.
 */
export const matrizService = {
  /** Empresas donde la cuenta puede entrar a la Matriz, con su rol y sus
   * capacidades en cada una. */
  misEmpresas() {
    return apiClient.get(`${BASE}/empresas/mias/`).then((res) => res.data);
  },
  resumen() {
    return apiClient.get(`${BASE}/resumen/`).then((res) => res.data);
  },
  periodos(params = {}) {
    return apiClient
      .get(`${BASE}/periodos/`, { params })
      .then((res) => res.data);
  },
  periodo(id) {
    return apiClient.get(`${BASE}/periodos/${id}/`).then((res) => res.data);
  },
  editarSeguimiento(id, datos) {
    return apiClient
      .patch(`${BASE}/periodos/${id}/`, datos)
      .then((res) => res.data);
  },
  historial(id) {
    return apiClient
      .get(`${BASE}/periodos/${id}/historial/`)
      .then((res) => res.data);
  },
  crearObligacion(datos) {
    return apiClient
      .post(`${BASE}/obligaciones/`, datos)
      .then((res) => res.data);
  },
  personas() {
    return apiClient.get(`${BASE}/personas/`).then((res) => res.data);
  },
  catalogos() {
    return apiClient.get(`${BASE}/catalogos/`).then((res) => res.data);
  },
};

/** Áreas y entidades de control: catálogos compartidos por las empresas. */
export function catalogoMatrizService(tipo) {
  const url = `${BASE}/catalogos/${tipo}/`;
  return {
    list: () => apiClient.get(url).then((res) => res.data),
    create: (datos) => apiClient.post(url, datos).then((res) => res.data),
    update: (id, datos) =>
      apiClient.patch(`${url}${id}/`, datos).then((res) => res.data),
    remove: (id) => apiClient.delete(`${url}${id}/`),
  };
}
