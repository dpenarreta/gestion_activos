import { apiClient } from "./client";

const CATALOGOS = "/catalogos/";

/**
 * Carga masiva de los catálogos, un archivo por catálogo.
 *
 * La lista viene del backend: un catálogo nuevo aparece en la pantalla sin
 * tocar el frontend, igual que un reporte nuevo.
 */
export const catalogosMasivosService = {
  listar() {
    return apiClient.get(CATALOGOS).then((res) => res.data);
  },

  plantilla(clave) {
    return apiClient
      .get(`${CATALOGOS}${clave}/plantilla/`, { responseType: "blob" })
      .then((res) => res.data);
  },

  /** Revisa el archivo sin guardar nada. */
  validar(clave, archivo) {
    return enviar(clave, archivo, false);
  },

  importar(clave, archivo) {
    return enviar(clave, archivo, true);
  },
};

function enviar(clave, archivo, confirmar) {
  const cuerpo = new FormData();
  cuerpo.append("archivo", archivo);
  cuerpo.append("confirmar", confirmar ? "true" : "false");
  return apiClient
    .post(`${CATALOGOS}${clave}/importar/`, cuerpo, {
      // Se deja que el navegador ponga el Content-Type: necesita añadir el
      // «boundary» del multipart, que no se puede escribir a mano. Sin esto
      // sale el `application/json` que el cliente pone por defecto y el
      // backend rechaza la petición sin haber leído el archivo.
      headers: { "Content-Type": undefined },
    })
    .then((res) => res.data);
}
