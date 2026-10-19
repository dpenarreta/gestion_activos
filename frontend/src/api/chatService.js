import { apiClient } from "./client";

const BASE = "/chat";

/** El chat de la empresa: canal general, mensajes directos y grupos. */
export const chatService = {
  conversaciones() {
    return apiClient.get(`${BASE}/conversaciones/`).then((r) => r.data);
  },
  conversacion(id) {
    return apiClient.get(`${BASE}/conversaciones/${id}/`).then((r) => r.data);
  },
  directa(usuario) {
    return apiClient
      .post(`${BASE}/conversaciones/directa/`, { usuario })
      .then((r) => r.data);
  },
  crearGrupo(datos) {
    return apiClient.post(`${BASE}/conversaciones/`, datos).then((r) => r.data);
  },
  editarGrupo(id, datos) {
    return apiClient
      .patch(`${BASE}/conversaciones/${id}/`, datos)
      .then((r) => r.data);
  },
  salir(id) {
    return apiClient.post(`${BASE}/conversaciones/${id}/salir/`);
  },
  mensajes(id, antes) {
    return apiClient
      .get(`${BASE}/conversaciones/${id}/mensajes/`, {
        params: antes ? { antes } : {},
      })
      .then((r) => r.data);
  },
  enviar(id, texto, archivo) {
    const datos = new FormData();
    datos.append("texto", texto ?? "");
    if (archivo) datos.append("archivo", archivo);
    return apiClient
      .post(`${BASE}/conversaciones/${id}/mensajes/`, datos, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
  leer(id, hasta) {
    return apiClient
      .post(`${BASE}/conversaciones/${id}/leer/`, hasta ? { hasta } : {})
      .then((r) => r.data);
  },
  /** Lo nuevo desde `desde` (sin él, solo el punto de partida). */
  novedades(desde) {
    return apiClient
      .get(`${BASE}/novedades/`, {
        params: desde !== null && desde !== undefined ? { desde } : {},
      })
      .then((r) => r.data);
  },
  directorio(q = "") {
    return apiClient
      .get(`${BASE}/directorio/`, { params: q ? { q } : {} })
      .then((r) => r.data);
  },
  areas() {
    return apiClient.get(`${BASE}/areas/`).then((r) => r.data);
  },
  /** Un archivo de un mensaje, como blob (la descarga exige sesión). */
  archivo(url) {
    return apiClient.get(url, { responseType: "blob" }).then((r) => r.data);
  },
};
