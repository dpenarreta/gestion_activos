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
    return apiClient.patch(`${ALERTAS}configuracion/`, payload).then((res) => res.data);
  },
};
