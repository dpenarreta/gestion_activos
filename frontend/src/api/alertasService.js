import { apiClient } from "./client";

const ALERTAS = "/alertas/";

export const alertasService = {
  /**
   * Alertas vigentes del parque (§19).
   *
   * El backend las calcula en cada llamada en vez de guardarlas: una alerta
   * persistida hay que retirarla cuando la situación se resuelve, y la que
   * nadie retira envejece hasta que se deja de mirar la pantalla entera.
   */
  resumen() {
    return apiClient.get(ALERTAS).then((res) => res.data);
  },
  configuracion() {
    return apiClient.get(`${ALERTAS}configuracion/`).then((res) => res.data);
  },
  guardarConfiguracion(payload) {
    return apiClient
      .patch(`${ALERTAS}configuracion/`, payload)
      .then((res) => res.data);
  },
  /**
   * Usuarios que pueden recibir el resumen por correo: activos, con correo y
   * con permiso para ver las alertas. El backend devuelve la dirección
   * enmascarada — sirve para reconocer a la persona, no para copiarla.
   */
  destinatariosDisponibles() {
    return apiClient.get(`${ALERTAS}destinatarios/`).then((res) => res.data);
  },
  /** Últimos envíos, incluidos los omitidos y los fallidos. */
  historialEnvios() {
    return apiClient.get(`${ALERTAS}envios/`).then((res) => res.data);
  },
  /** Envía el resumen de hoy al correo de quien lo solicita, y a nadie más. */
  enviarPrueba() {
    return apiClient.post(`${ALERTAS}envios/prueba/`).then((res) => res.data);
  },
};
