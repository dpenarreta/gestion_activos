import { apiClient } from "./client";

const ADJUNTOS = "/adjuntos/";

export const adjuntosService = {
  list(params = {}) {
    return apiClient.get(ADJUNTOS, { params }).then((res) => res.data);
  },

  /**
   * Sube un archivo.
   *
   * Va como `multipart/form-data` y sin cabecera `Content-Type` explícita: el
   * navegador tiene que añadir el `boundary`, y fijarla a mano lo rompe.
   */
  subir({ activo, mantenimiento, tipo, archivo, descripcion }) {
    const datos = new FormData();
    datos.append("activo", activo);
    datos.append("tipo", tipo);
    datos.append("archivo", archivo);
    if (mantenimiento) datos.append("mantenimiento", mantenimiento);
    if (descripcion) datos.append("descripcion", descripcion);
    return apiClient.post(ADJUNTOS, datos).then((res) => res.data);
  },

  remove(id) {
    return apiClient.delete(`${ADJUNTOS}${id}/`).then((res) => res.data);
  },

  descargar(id) {
    return apiClient
      .get(`${ADJUNTOS}${id}/descargar/`, { responseType: "blob" })
      .then((res) => res.data);
  },

  /** Acta de entrega o devolución de un movimiento, sin archivarla. */
  acta(movimientoId) {
    return apiClient
      .get(`${ADJUNTOS}acta/`, { params: { movimiento: movimientoId }, responseType: "blob" })
      .then((res) => res.data);
  },

  /** Genera el acta y la guarda en la ficha del activo. */
  archivarActa(movimientoId) {
    return apiClient
      .post(`${ADJUNTOS}acta/`, { movimiento: movimientoId })
      .then((res) => res.data);
  },
};
