import { apiClient } from "./client";

const SOLICITUDES = "/solicitudes/";

export const solicitudesService = {
  /** El ámbito decide la pantalla: `mias` o `recibidas`. */
  list(params = {}) {
    return apiClient.get(SOLICITUDES, { params }).then((res) => res.data);
  },
  get(id) {
    return apiClient.get(`${SOLICITUDES}${id}/`).then((res) => res.data);
  },
  create(payload) {
    return apiClient.post(SOLICITUDES, payload).then((res) => res.data);
  },
  update(id, payload) {
    return apiClient
      .patch(`${SOLICITUDES}${id}/`, payload)
      .then((res) => res.data);
  },
  /** Un paso del recorrido: tomarla, comprarla, entregarla, rechazarla o cancelarla. */
  cambiarEstado(id, estado, nota = "") {
    return apiClient
      .post(`${SOLICITUDES}${id}/cambiar-estado/`, { estado, nota })
      .then((res) => res.data);
  },
  /** Tipos de equipo y componentes para el desplegable de «qué necesita».
   *
   * Sale de solicitudes y no del inventario: quien solo pide no tiene permiso
   * para ver el parque, y por ahí el desplegable le llegaría vacío por un 403
   * que nadie ve.
   */
  catalogo() {
    return apiClient.get(`${SOLICITUDES}catalogo/`).then((res) => res.data);
  },
  /** A quién se le puede asignar: solo quien puede atenderla. */
  encargados() {
    return apiClient.get(`${SOLICITUDES}encargados/`).then((res) => res.data);
  },
};
