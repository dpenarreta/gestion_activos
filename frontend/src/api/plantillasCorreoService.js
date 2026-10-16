import { apiClient } from "./client";

const BASE = "/configuracion/correos/plantillas/";

/** Configuración → Notificaciones → Plantillas de correo. */
export const plantillasCorreoService = {
  list() {
    return apiClient.get(BASE).then((res) => res.data);
  },
  get(clave) {
    return apiClient.get(`${BASE}${clave}/`).then((res) => res.data);
  },
  guardar(clave, { asunto, html }) {
    return apiClient
      .put(`${BASE}${clave}/`, { asunto, html })
      .then((res) => res.data);
  },
  /** Vuelve al diseño por defecto. */
  restablecer(clave) {
    return apiClient.delete(`${BASE}${clave}/`).then((res) => res.data);
  },
  /** El borrador con datos de ejemplo, sin guardarlo. */
  vistaPrevia(clave, { asunto, html }) {
    return apiClient
      .post(`${BASE}${clave}/vista-previa/`, { asunto, html })
      .then((res) => res.data);
  },
  /** Envía la plantilla guardada, con datos de ejemplo, a quien la pide. */
  probar(clave) {
    return apiClient.post(`${BASE}${clave}/prueba/`).then((res) => res.data);
  },
};
