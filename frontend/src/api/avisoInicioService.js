import { apiClient } from "./client";

const URL = "/organizacion/aviso-inicio/";

/** El aviso importante que se muestra a todos al entrar al sistema. */
export const avisoInicioService = {
  obtener() {
    return apiClient.get(URL).then((res) => res.data);
  },
  /** Guarda el aviso; `imagen` reemplaza la actual y `quitar_imagen` la
   * quita. Va como formulario multipart por la imagen. */
  guardar(campos, imagen) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) datos.append(clave, valor);
    });
    if (imagen) datos.append("imagen", imagen);
    return apiClient.put(URL, datos).then((res) => res.data);
  },
  /** La imagen, como blob (no tiene URL pública). */
  imagen() {
    return apiClient
      .get(`${URL}imagen/`, { responseType: "blob" })
      .then((res) => res.data);
  },
};
