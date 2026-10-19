import { apiClient } from "./client";

/** «Mi perfil»: el teléfono, el área y la agencia de quien entra (y su nombre). */
export const misDatosService = {
  obtener() {
    return apiClient.get("/organizacion/mis-datos/").then((r) => r.data);
  },
  guardar(datos) {
    return apiClient.put("/organizacion/mis-datos/", datos).then((r) => r.data);
  },
};
