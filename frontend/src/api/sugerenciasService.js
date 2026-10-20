import { apiClient } from "./client";

const BASE = "/sugerencias/reportes/";

/** Sugerencias y errores: reportar, seguir lo propio y, con permiso, gestionar. */
export const sugerenciasService = {
  opciones() {
    return apiClient.get(`${BASE}opciones/`).then((r) => r.data);
  },
  /** `vista`: "mios" o "todos"; filtros opcionales: estado, tipo, modulo. */
  listar(vista = "mios", filtros = {}) {
    return apiClient
      .get(BASE, { params: { vista, ...filtros } })
      .then((r) => r.data);
  },
  detalle(id) {
    return apiClient.get(`${BASE}${id}/`).then((r) => r.data);
  },
  reportar(campos, captura) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null && valor !== "")
        datos.append(clave, valor);
    });
    if (captura) datos.append("captura", captura);
    return apiClient.post(BASE, datos).then((r) => r.data);
  },
  comentar(id, texto) {
    return apiClient
      .post(`${BASE}${id}/comentar/`, { texto })
      .then((r) => r.data);
  },
  cambiarEstado(id, estado, texto = "") {
    return apiClient
      .post(`${BASE}${id}/estado/`, { estado, texto })
      .then((r) => r.data);
  },
  captura(id) {
    return apiClient
      .get(`${BASE}${id}/captura/`, { responseType: "blob" })
      .then((r) => r.data);
  },
};
