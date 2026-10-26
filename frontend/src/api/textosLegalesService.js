import { apiClient } from "./client";

/** Configuración → Textos legales: los textos de tratamiento de datos
 * personales que aceptan las personas (26/10/2026). */
export const textosLegalesService = {
  listar() {
    return apiClient.get("/organizacion/textos-legales/").then((r) => r.data);
  },
  /** Cambia el texto; si cambió, sube su versión. Devuelve el texto vigente. */
  guardar(clave, texto) {
    return apiClient
      .put(`/organizacion/textos-legales/${clave}/`, { texto })
      .then((r) => r.data);
  },
};
