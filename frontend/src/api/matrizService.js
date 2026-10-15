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

  // --- Evidencias y cierre (fase 3) ---
  documentos(id) {
    return apiClient
      .get(`${BASE}/periodos/${id}/documentos/`)
      .then((res) => res.data);
  },
  /** Sube un PDF; `alProgresar` recibe el porcentaje enviado. */
  cargarEvidencia(id, archivo, alProgresar) {
    const datos = new FormData();
    datos.append("file", archivo);
    return apiClient
      .post(`${BASE}/periodos/${id}/documentos/`, datos, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evento) => {
          if (alProgresar && evento.total) {
            alProgresar(Math.round((evento.loaded / evento.total) * 100));
          }
        },
      })
      .then((res) => res.data);
  },
  /** El PDF como `Blob`: el endpoint exige la sesión, así que no puede ir
   * directo al `src` de un visor; se pide con el cliente autenticado. */
  archivo(documentoId, { descarga = false } = {}) {
    return apiClient
      .get(`${BASE}/documentos/${documentoId}/archivo/`, {
        params: descarga ? { download: 1 } : {},
        responseType: "blob",
      })
      .then((res) => res.data);
  },
  rechazarDocumento(documentoId, reason) {
    return apiClient
      .post(`${BASE}/documentos/${documentoId}/rechazar/`, { reason })
      .then((res) => res.data);
  },
  eliminarDocumento(documentoId) {
    return apiClient.delete(`${BASE}/documentos/${documentoId}/`);
  },
  enviar(id) {
    return apiClient
      .post(`${BASE}/periodos/${id}/enviar/`)
      .then((res) => res.data);
  },
  validar(id) {
    return apiClient
      .post(`${BASE}/periodos/${id}/validar/`)
      .then((res) => res.data);
  },
  devolver(id, reason) {
    return apiClient
      .post(`${BASE}/periodos/${id}/devolver/`, { reason })
      .then((res) => res.data);
  },
  cambiarVencimiento(id, datos) {
    return apiClient
      .post(`${BASE}/periodos/${id}/vencimiento/`, datos)
      .then((res) => res.data);
  },
  documentosResumen() {
    return apiClient.get(`${BASE}/documentos/`).then((res) => res.data);
  },

  // Recordatorios (fase 4)
  recordatorios(id) {
    return apiClient
      .get(`${BASE}/periodos/${id}/recordatorios/`)
      .then((res) => res.data);
  },
  enviarRecordatorio(id) {
    return apiClient
      .post(`${BASE}/periodos/${id}/recordatorios/enviar/`)
      .then((res) => res.data);
  },
  vistaPrevia(id, kind) {
    return apiClient
      .get(`${BASE}/periodos/${id}/recordatorios/vista-previa/`, {
        params: { kind },
      })
      .then((res) => res.data);
  },
  configuracionRecordatorios() {
    return apiClient
      .get(`${BASE}/recordatorios/configuracion/`)
      .then((res) => res.data);
  },
  guardarConfiguracionRecordatorios(datos) {
    return apiClient
      .put(`${BASE}/recordatorios/configuracion/`, datos)
      .then((res) => res.data);
  },
  notificaciones(params = {}) {
    return apiClient
      .get(`${BASE}/notificaciones/`, { params })
      .then((res) => res.data);
  },
  reintentarNotificacion(id) {
    return apiClient
      .post(`${BASE}/notificaciones/${id}/reintentar/`)
      .then((res) => res.data);
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
