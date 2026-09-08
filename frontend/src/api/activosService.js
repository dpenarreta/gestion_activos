import { apiClient } from "./client";

const ACTIVOS = "/activos/";
const TIPOS = "/activos/tipos/";

export const activosService = {
  list(params = {}) {
    return apiClient.get(ACTIVOS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${ACTIVOS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(ACTIVOS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${ACTIVOS}${id}/`, payload).then((res) => res.data);
  },

  /**
   * Resuelve lo que emitió el lector de códigos de barras (RF-03).
   *
   * Devuelve la ficha con historial y costos en una sola llamada: el técnico
   * escanea en campo y necesita todo de inmediato, así que encadenar tres
   * peticiones por escaneo sería peor sobre una conexión móvil.
   */
  porCodigo(codigo) {
    return apiClient.get(`${ACTIVOS}por-codigo/${encodeURIComponent(codigo)}/`).then((res) => res.data);
  },
  historial(id) {
    return apiClient.get(`${ACTIVOS}${id}/historial/`).then((res) => res.data);
  },
  asignar(id, payload) {
    return apiClient.post(`${ACTIVOS}${id}/asignar/`, payload).then((res) => res.data);
  },
  cambiarEstado(id, payload) {
    return apiClient.post(`${ACTIVOS}${id}/cambiar-estado/`, payload).then((res) => res.data);
  },
  etiqueta(id, formato = "zpl") {
    return apiClient.get(`${ACTIVOS}${id}/etiqueta/`, { params: { formato } }).then((res) => res.data);
  },
  etiquetasLote(ids, formato = "zpl") {
    return apiClient
      .post(`${ACTIVOS}etiquetas/`, { ids }, { params: { formato } })
      .then((res) => res.data);
  },

  /**
   * Descarga el trabajo de impresión como archivo.
   *
   * Va por axios y se materializa en un blob en vez de apuntar un enlace
   * directo al endpoint: la API se autentica con `Authorization: Bearer`, y
   * una navegación directa del navegador no lleva ese encabezado. Poner el
   * token en la query para sortearlo lo dejaría en el historial del
   * navegador y en los logs del servidor, que es justo lo que no se quiere
   * de un token de sesión.
   */
  descargarEtiqueta(id, formato = "pdf") {
    return apiClient
      .get(`${ACTIVOS}${id}/etiqueta/`, {
        params: { formato, descargar: "true" },
        responseType: "blob",
      })
      .then((res) => res.data);
  },

  /** PDF listo para revisar en el visor del navegador, sin descargarlo. */
  previsualizarPdf(id) {
    return apiClient
      .get(`${ACTIVOS}${id}/etiqueta/`, {
        params: { formato: "pdf", descargar: "false" },
        responseType: "blob",
      })
      .then((res) => res.data);
  },

  descargarEtiquetasLote(ids, formato = "pdf") {
    return apiClient
      .post(`${ACTIVOS}etiquetas/`, { ids }, { params: { formato }, responseType: "blob" })
      .then((res) => res.data);
  },
};

export const importacionActivosService = {
  /** Plantilla .xlsx con los catálogos vigentes y las instrucciones. */
  descargarPlantilla() {
    return apiClient
      .get(`${ACTIVOS}plantilla-importacion/`, { responseType: "blob" })
      .then((res) => res.data);
  },

  /**
   * Sube el archivo para validarlo o para importarlo.
   *
   * El mismo archivo se envía en las dos pasadas: el servidor no guarda cargas
   * a medio procesar entre la validación y la confirmación, lo que evitaría
   * tener que limpiarlas y decidir qué pasa si el catálogo cambia entre una y
   * otra.
   */
  enviar(archivo, { confirmar = false } = {}) {
    const datos = new FormData();
    datos.append("archivo", archivo);
    datos.append("confirmar", confirmar ? "true" : "false");
    return apiClient
      .post(`${ACTIVOS}importar/`, datos, {
        // Se deja que el navegador ponga el Content-Type: necesita añadir el
        // "boundary" del multipart, que no se puede escribir a mano.
        headers: { "Content-Type": undefined },
      })
      .then((res) => res.data);
  },
};

export const dashboardService = {
  indicadores() {
    return apiClient.get(`${ACTIVOS}dashboard/`).then((res) => res.data);
  },
};

export const exportacionService = {
  /** Inventario en .xlsx con los filtros que reciba (los mismos del listado). */
  activos(params = {}) {
    return apiClient
      .get(`${ACTIVOS}exportar/`, { params, responseType: "blob" })
      .then((res) => res.data);
  },
  mantenimientos(params = {}) {
    return apiClient
      .get("/mantenimientos/exportar/", { params, responseType: "blob" })
      .then((res) => res.data);
  },
};

export const columnasPlantillaService = {
  list() {
    return apiClient.get(`${ACTIVOS}columnas-plantilla/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(`${ACTIVOS}columnas-plantilla/`, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${ACTIVOS}columnas-plantilla/${id}/`, payload)
      .then((res) => res.data);
  },
  remove(id) {
    return apiClient.delete(`${ACTIVOS}columnas-plantilla/${id}/`).then((res) => res.data);
  },
  camposDisponibles() {
    return apiClient
      .get(`${ACTIVOS}columnas-plantilla/campos-disponibles/`)
      .then((res) => res.data);
  },
};

export const tiposDispositivoService = {
  list(params = {}) {
    return apiClient.get(TIPOS, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${TIPOS}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(TIPOS, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient.patch(`${TIPOS}${id}/`, payload).then((res) => res.data);
  },
};
