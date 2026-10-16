import { apiClient } from "./client";

/** El correo del sistema: por dónde sale y su prueba. */
export const correoService = {
  estado() {
    return apiClient.get("/configuracion/correo/").then((res) => res.data);
  },
  /** Envía una prueba al correo de quien la pide, y a nadie más. */
  enviarPrueba() {
    return apiClient
      .post("/configuracion/correo/prueba/")
      .then((res) => res.data);
  },
};
