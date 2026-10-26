import { apiClient } from "./client";

const BASE = "/proyectos/";

/** Solicitud de proyectos: los tipos de proyecto (con su plantilla, su
 * formulario y sus pasos), las solicitudes y su aprobación. */
export const proyectosService = {
  /** Los tipos que se pueden solicitar, con su formulario y sus pasos. */
  tipos() {
    return apiClient.get(`${BASE}tipos/`).then((res) => res.data);
  },
  /** La plantilla de un tipo activo, para llenarla. */
  plantilla(tipo) {
    return apiClient
      .get(`${BASE}tipos/${tipo}/plantilla/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  /** `vista`: "mias", "por_atender" o "todas". */
  solicitudes(vista = "mias") {
    return apiClient
      .get(`${BASE}solicitudes/`, { params: { vista } })
      .then((res) => res.data);
  },
  solicitud(id) {
    return apiClient.get(`${BASE}solicitudes/${id}/`).then((res) => res.data);
  },
  resumen() {
    return apiClient.get(`${BASE}solicitudes/resumen/`).then((res) => res.data);
  },
  /** `respuestas`: clave del campo → valor; `archivo`: la plantilla llena. */
  solicitar({ tipo_proyecto, titulo, respuestas }, archivo) {
    const datos = new FormData();
    datos.append("tipo_proyecto", tipo_proyecto);
    datos.append("titulo", titulo);
    datos.append("respuestas", JSON.stringify(respuestas ?? {}));
    if (archivo) datos.append("archivo", archivo);
    return apiClient.post(`${BASE}solicitudes/`, datos).then((res) => res.data);
  },
  aprobar(id, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/aprobar/`, { comentario })
      .then((res) => res.data);
  },
  rechazar(id, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/rechazar/`, { comentario })
      .then((res) => res.data);
  },
  cancelar(id, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/cancelar/`, { comentario })
      .then((res) => res.data);
  },
  /** `destino`: { tipo: "persona" | "rol" | "cargo", usuario | rol | cargo }. */
  escalar(id, destino, comentario) {
    return apiClient
      .post(`${BASE}solicitudes/${id}/escalar/`, { destino, comentario })
      .then((res) => res.data);
  },
  /** La plantilla llena que cargó quien solicita. */
  archivo(id) {
    return apiClient
      .get(`${BASE}solicitudes/${id}/archivo/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  /** Personas, roles y cargos para elegir. */
  opciones() {
    return apiClient.get(`${BASE}opciones/`).then((res) => res.data);
  },
  // --- Configuración de los tipos (proyectos.configurar) ------------------
  tiposConfigurados() {
    return apiClient.get(`${BASE}configuracion/tipos/`).then((res) => res.data);
  },
  guardarTipo(id, datos) {
    const pedido = id
      ? apiClient.put(`${BASE}configuracion/tipos/${id}/`, datos)
      : apiClient.post(`${BASE}configuracion/tipos/`, datos);
    return pedido.then((res) => res.data);
  },
  activarTipo(id, activo) {
    return apiClient
      .patch(`${BASE}configuracion/tipos/${id}/`, { activo })
      .then((res) => res.data);
  },
  eliminarTipo(id) {
    return apiClient.delete(`${BASE}configuracion/tipos/${id}/`);
  },
  cargarPlantilla(id, archivo) {
    const datos = new FormData();
    datos.append("plantilla", archivo);
    return apiClient
      .post(`${BASE}configuracion/tipos/${id}/plantilla/`, datos)
      .then((res) => res.data);
  },
  plantillaConfigurada(id) {
    return apiClient
      .get(`${BASE}configuracion/tipos/${id}/plantilla/`, {
        responseType: "blob",
      })
      .then((res) => res.data);
  },
};

/** Descarga un blob con su nombre. */
export function guardarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
