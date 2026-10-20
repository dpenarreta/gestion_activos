import { apiClient } from "./client";

const BASE = "/licencias/";

/** Solicitud de permisos: los tipos de permiso (flujos), las solicitudes y su
 * aprobación. */
export const licenciasService = {
  /** Los tipos de permiso que se pueden solicitar, con sus pasos. */
  tipos() {
    return apiClient.get(`${BASE}tipos/`).then((res) => res.data);
  },
  /** Las restricciones de un tipo de permiso para esas fechas, con si se
   * cumplen: `{ reglas: [{ clave, estado, texto, detalle }], bloquea }`. */
  evaluar(flujo, desde, hasta) {
    return apiClient
      .get(`${BASE}tipos/${flujo}/evaluar/`, { params: { desde, hasta } })
      .then((res) => res.data);
  },
  /** `vista`: "mias", "por_aprobar" o "todas". */
  solicitudes(vista = "mias") {
    return apiClient
      .get(`${BASE}solicitudes/`, { params: { vista } })
      .then((res) => res.data);
  },
  solicitud(id) {
    return apiClient.get(`${BASE}solicitudes/${id}/`).then((res) => res.data);
  },
  resumen() {
    return apiClient.get(`${BASE}solicitudes/resumen/`).then((res) => res.data);
  },
  solicitar(campos, adjunto) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) datos.append(clave, valor);
    });
    if (adjunto) datos.append("adjunto", adjunto);
    return apiClient.post(`${BASE}solicitudes/`, datos).then((res) => res.data);
  },
  aprobar(id, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/aprobar/`, { comentario })
      .then((res) => res.data);
  },
  rechazar(id, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/rechazar/`, { comentario })
      .then((res) => res.data);
  },
  cancelar(id, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/cancelar/`, { comentario })
      .then((res) => res.data);
  },
  /** `destino`: { tipo: "persona" | "rol" | "cargo", usuario | rol | cargo }. */
  escalar(id, destino, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/escalar/`, { destino, comentario })
      .then((res) => res.data);
  },
  adjunto(id) {
    return apiClient
      .get(`${BASE}solicitudes/${id}/adjunto/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  /** Personas, roles y cargos para elegir. */
  opciones() {
    return apiClient.get(`${BASE}opciones/`).then((res) => res.data);
  },
  // --- Configuración de los flujos (licencias.configurar) -----------------
  flujos() {
    return apiClient.get(`${BASE}flujos/`).then((res) => res.data);
  },
  guardarFlujo(id, datos) {
    const pedido = id
      ? apiClient.put(`${BASE}flujos/${id}/`, datos)
      : apiClient.post(`${BASE}flujos/`, datos);
    return pedido.then((res) => res.data);
  },
  eliminarFlujo(id) {
    return apiClient.delete(`${BASE}flujos/${id}/`);
  },
};
