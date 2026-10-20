import { apiClient } from "./client";

const BASE = "/nomina/rol-pagos/";

/** Consultar rol de pagos: el código sale de la sesión; ver pide aceptar los
 * términos y la contraseña de la cuenta. El PDF no se guarda. */
export const nominaService = {
  estado() {
    return apiClient.get(BASE).then((r) => r.data);
  },
  /** Devuelve `{ blob, consulta }`: el PDF y el número de la consulta (para
   * enviarlo después al correo). */
  consultar(datos) {
    return apiClient
      .post(`${BASE}consultar/`, datos, { responseType: "blob" })
      .then((r) => ({
        blob: r.data,
        consulta: Number(r.headers["x-consulta-rol"]),
      }));
  },
  /** `correo` vacío usa el guardado; `guardar` + `acepto_guardar` lo guarda. */
  enviar(datos) {
    return apiClient.post(`${BASE}enviar/`, datos).then((r) => r.data);
  },
  olvidarCorreo() {
    return apiClient.delete(`${BASE}correo-personal/`);
  },
  configurar(datos) {
    return apiClient.put(`${BASE}configuracion/`, datos).then((r) => r.data);
  },
};
