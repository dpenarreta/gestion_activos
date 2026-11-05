import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/projects";

const datos = (r) => r.data;

/**
 * El error de una llamada de Proyectos, ya legible y con lo que la pantalla
 * necesita para decidir: el código (`permission_denied`, `conflict`,
 * `not_found`, `validation_error`…), el estado HTTP y los errores por campo.
 * El contrato de error es el mismo de Tareas (`{"error": {"code", "message",
 * "details"}}`), así que se reutiliza su lectura. La lógica decide por
 * `codigo` o `estado`, nunca por el texto.
 */
export function errorDeProyectos(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  return errorDeTareas(err, porDefecto);
}

/**
 * Proyectos de Gestión Humana (no confundir con `proyectosService`, la
 * Solicitud de proyectos de Institucional). Contrato: `/api/v1/projects/`.
 * El servidor vuelve a autorizar cada petición: quién ve un proyecto (404 si
 * no lo ve), quién lo gestiona o participa (403) y quién lo envía a la
 * papelera. Ocultar un botón aquí nunca es la barrera.
 */
export const proyectosGhService = {
  // --- Quién es y a quién puede elegir ---
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),
  miembros: () => apiClient.get(`${BASE}/members/`).then(datos),

  // --- Proyectos ---
  listar: () => apiClient.get(`${BASE}/`).then(datos),
  obtener: (id) => apiClient.get(`${BASE}/${id}/`).then(datos),
  crear: (valores) => apiClient.post(`${BASE}/`, valores).then(datos),
  actualizar: (id, valores) =>
    apiClient.patch(`${BASE}/${id}/`, valores).then(datos),

  // --- Papelera ---
  enviarAPapelera: (id) => apiClient.delete(`${BASE}/${id}/`).then(datos),
  papelera: () => apiClient.get(`${BASE}/trash/`).then(datos),
  restaurar: (id) => apiClient.post(`${BASE}/${id}/restore/`).then(datos),
  eliminarParaSiempre: (id) =>
    apiClient.delete(`${BASE}/${id}/permanent/`).then(datos),

  // --- Participantes ---
  agregarParticipante: (id, usuario) =>
    apiClient
      .post(`${BASE}/${id}/participants/`, { user: usuario })
      .then(datos),
  quitarParticipante: (id, participanteId) =>
    apiClient
      .delete(`${BASE}/${id}/participants/${participanteId}/`)
      .then(datos),

  // --- Fases ---
  crearFase: (id, valores) =>
    apiClient.post(`${BASE}/${id}/phases/`, valores).then(datos),
  actualizarFase: (id, faseId, valores) =>
    apiClient.patch(`${BASE}/${id}/phases/${faseId}/`, valores).then(datos),
  eliminarFase: (id, faseId) =>
    apiClient.delete(`${BASE}/${id}/phases/${faseId}/`).then(datos),

  // --- Actividades, comentarios e historial ---
  actividades: (id) => apiClient.get(`${BASE}/${id}/activities/`).then(datos),
  registrarActividad: (id, valores) =>
    apiClient.post(`${BASE}/${id}/activities/`, valores).then(datos),
  comentarios: (id) => apiClient.get(`${BASE}/${id}/comments/`).then(datos),
  comentar: (id, text) =>
    apiClient.post(`${BASE}/${id}/comments/`, { text }).then(datos),
  historial: (id) => apiClient.get(`${BASE}/${id}/history/`).then(datos),

  // --- Documentos ---
  documentos: (id) => apiClient.get(`${BASE}/${id}/documents/`).then(datos),
  /** Multipart con `file`: el servidor valida tamaño, extensión y firma del
   * contenido, y responde con el motivo si no lo admite. */
  subirDocumento: (id, archivo, { categoria, versionAnterior } = {}) => {
    const formulario = new FormData();
    formulario.append("file", archivo);
    if (categoria) formulario.append("category", categoria);
    if (versionAnterior)
      formulario.append("previous_version_id", String(versionAnterior));
    return apiClient.post(`${BASE}/${id}/documents/`, formulario).then(datos);
  },
};
