import { apiClient } from "./client";

const REPORTES = "/reportes/";

/**
 * Los trece reportes del §16.
 *
 * La pantalla no conoce ningún reporte en particular: se dibuja a partir del
 * catálogo que devuelve el backend —qué reportes hay, qué parámetros admite
 * cada uno y qué columnas tiene—, así que un reporte nuevo aparece sin tocar
 * el frontend.
 */
export const reportesService = {
  catalogo() {
    return apiClient.get(REPORTES).then((res) => res.data);
  },
  /** Vista previa en JSON: las primeras filas, para reconocer el reporte. */
  vistaPrevia(clave, params = {}) {
    return apiClient
      .get(`${REPORTES}${clave}/`, { params })
      .then((res) => res.data);
  },
  /**
   * Descarga el archivo. Se pide por axios y no por navegación directa
   * porque la API exige `Authorization`, y llevar el token en la query lo
   * dejaría en el historial del navegador y en los logs del servidor.
   */
  descargar(clave, formato, params = {}) {
    return apiClient
      .get(`${REPORTES}${clave}/`, {
        params: { ...params, formato },
        responseType: "blob",
      })
      .then((res) => res.data);
  },
};
