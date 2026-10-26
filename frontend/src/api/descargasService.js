import { apiClient } from "./client";

const BASE = "/descargas/";

/** Auditoría → Descargas de archivos (`auditoria.descargas`, 26/10/2026). */
export const descargasService = {
  /** `{ q, desde, hasta, modulo, page }`: paginado, lo más reciente primero. */
  listar(params) {
    return apiClient.get(BASE, { params }).then((r) => r.data);
  },
  modulos() {
    return apiClient.get(`${BASE}modulos/`).then((r) => r.data);
  },
  /** La copia exacta del archivo que se descargó. */
  copia(id) {
    return apiClient
      .get(`${BASE}${id}/copia/`, { responseType: "blob" })
      .then((r) => r.data);
  },
  exportar(params) {
    return apiClient
      .get(`${BASE}exportar/`, { params, responseType: "blob" })
      .then((r) => r.data);
  },
};
