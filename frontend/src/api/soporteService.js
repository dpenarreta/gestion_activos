import { apiClient } from "./client";

const BASE = "/soporte";

/** Arma un FormData con los campos y los adjuntos (`adjuntos`). */
function conArchivos(campos, archivos = []) {
  const datos = new FormData();
  Object.entries(campos).forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== null) datos.append(clave, valor);
  });
  archivos.forEach((archivo) => datos.append("adjuntos", archivo));
  return datos;
}

const multipart = { headers: { "Content-Type": "multipart/form-data" } };

/** Mesa de ayuda. Lo público no usa sesión: el servidor lo acota por el
 * código de la empresa o por el enlace secreto del ticket. */
export const soporteService = {
  // --- Público ---
  formulario(codigo) {
    return apiClient.get(`${BASE}/publico/${codigo}/`).then((r) => r.data);
  },
  crearTicket(codigo, campos, archivos) {
    return apiClient
      .post(
        `${BASE}/publico/${codigo}/`,
        conArchivos(campos, archivos),
        multipart,
      )
      .then((r) => r.data);
  },
  seguimiento(token) {
    return apiClient.get(`${BASE}/seguimiento/${token}/`).then((r) => r.data);
  },
  responderComoSolicitante(token, texto, archivos) {
    return apiClient
      .post(
        `${BASE}/seguimiento/${token}/`,
        conArchivos({ texto }, archivos),
        multipart,
      )
      .then((r) => r.data);
  },
  confirmarSolucion(token) {
    return apiClient
      .post(`${BASE}/seguimiento/${token}/`, { confirmar: true })
      .then((r) => r.data);
  },

  // --- Equipo ---
  bandeja() {
    return apiClient.get(`${BASE}/tickets/bandeja/`).then((r) => r.data);
  },
  tickets(params = {}) {
    return apiClient.get(`${BASE}/tickets/`, { params }).then((r) => r.data);
  },
  ticket(id) {
    return apiClient.get(`${BASE}/tickets/${id}/`).then((r) => r.data);
  },
  /** A quién se puede asignar (quien coordina). */
  tecnicos() {
    return apiClient.get(`${BASE}/tickets/tecnicos/`).then((r) => r.data);
  },
  tomarSiguiente() {
    return apiClient
      .post(`${BASE}/tickets/tomar-siguiente/`)
      .then((r) => r.data);
  },
  cambiarEstado(id, estado, nota = "") {
    return apiClient
      .post(`${BASE}/tickets/${id}/cambiar-estado/`, { estado, nota })
      .then((r) => r.data);
  },
  escalar(id, motivo) {
    return apiClient
      .post(`${BASE}/tickets/${id}/escalar/`, { motivo })
      .then((r) => r.data);
  },
  asignar(id, tecnico, nota = "") {
    return apiClient
      .post(`${BASE}/tickets/${id}/asignar/`, { tecnico, nota })
      .then((r) => r.data);
  },
  responder(id, { texto, interno }, archivos) {
    return apiClient
      .post(
        `${BASE}/tickets/${id}/responder/`,
        conArchivos({ texto, interno: interno ? "true" : "false" }, archivos),
        multipart,
      )
      .then((r) => r.data);
  },
  registrarHoras(id, datos) {
    return apiClient
      .post(`${BASE}/tickets/${id}/horas/`, datos)
      .then((r) => r.data);
  },
  /** Descarga un adjunto (la URL la da el servidor). */
  descargar(url) {
    return apiClient.get(url, { responseType: "blob" });
  },
  horas(params = {}) {
    return apiClient.get(`${BASE}/horas/`, { params }).then((r) => r.data);
  },
  revisarHoras(id, aprobar, nota = "") {
    return apiClient
      .post(`${BASE}/horas/${id}/revisar/`, { aprobar, nota })
      .then((r) => r.data);
  },
  miHorario() {
    return apiClient.get(`${BASE}/mi-horario/`).then((r) => r.data);
  },
  guardarMiHorario(datos) {
    return apiClient.put(`${BASE}/mi-horario/`, datos).then((r) => r.data);
  },
  respuestas() {
    return apiClient.get(`${BASE}/config/respuestas/`).then((r) => r.data);
  },

  // --- Configuración ---
  config: {
    listar(recurso) {
      return apiClient.get(`${BASE}/config/${recurso}/`).then((r) => r.data);
    },
    crear(recurso, datos) {
      return apiClient
        .post(`${BASE}/config/${recurso}/`, datos)
        .then((r) => r.data);
    },
    actualizar(recurso, id, datos) {
      return apiClient
        .patch(`${BASE}/config/${recurso}/${id}/`, datos)
        .then((r) => r.data);
    },
    eliminar(recurso, id) {
      return apiClient.delete(`${BASE}/config/${recurso}/${id}/`);
    },
    personas() {
      return apiClient
        .get(`${BASE}/config/tecnicos/personas/`)
        .then((r) => r.data);
    },
    /** El código de la empresa activa, para el enlace del formulario público. */
    codigoFormulario() {
      return apiClient
        .get(`${BASE}/config/niveles/formulario/`)
        .then((r) => r.data);
    },
    /** Deja los campos del formulario en el orden de `ids`. */
    ordenarCampos(ids) {
      return apiClient
        .post(`${BASE}/config/formulario/ordenar/`, { ids })
        .then((r) => r.data);
    },
  },

  // --- Reportes ---
  reportes(params = {}) {
    return apiClient.get(`${BASE}/reportes/`, { params }).then((r) => r.data);
  },
};
