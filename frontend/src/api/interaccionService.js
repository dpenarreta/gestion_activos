import { apiClient } from "./client";

const BASE = "/interaccion";

/** La interacción con la plataforma (18/11/2026): el latido de actividad y
 * el resumen del dashboard «Interacción de la plataforma». */
export const interaccionService = {
  latido(titulo) {
    return apiClient.post(`${BASE}/latido/`, { titulo });
  },
  resumen(dias) {
    return apiClient
      .get(`${BASE}/resumen/`, { params: { dias } })
      .then((r) => r.data);
  },
};
