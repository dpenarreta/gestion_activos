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
  // --- Quien pide soporte (con sesión) ---
  /** Lo que muestra «Soporte TI → Nuevo ticket», con «Mi perfil». */
  solicitar() {
    return apiClient.get(`${BASE}/solicitar/`).then((r) => r.data);
  },
  crearTicket(campos, archivos) {
    return apiClient
      .post(`${BASE}/solicitar/`, conArchivos(campos, archivos), multipart)
      .then((r) => r.data);
  },
  misTickets() {
    return apiClient.get(`${BASE}/mis-tickets/`).then((r) => r.data);
  },
  miTicket(id) {
    return apiClient.get(`${BASE}/mis-tickets/${id}/`).then((r) => r.data);
  },
  responderMiTicket(id, texto, archivos) {
    return apiClient
      .post(
        `${BASE}/mis-tickets/${id}/`,
        conArchivos({ texto }, archivos),
        multipart,
      )
      .then((r) => r.data);
  },
  /** El chat del ticket, del lado de quien lo reportó. */
  miChat(id) {
    return apiClient.get(`${BASE}/mis-tickets/${id}/chat/`).then((r) => r.data);
  },
  escribirMiChat(id, texto) {
    return apiClient
      .post(`${BASE}/mis-tickets/${id}/chat/`, { texto })
      .then((r) => r.data);
  },
  confirmarMiTicket(id) {
    return apiClient
      .post(`${BASE}/mis-tickets/${id}/`, { confirmar: true })
      .then((r) => r.data);
  },
  encuestaMiTicket(id, datos) {
    return apiClient
      .post(`${BASE}/mis-tickets/${id}/encuesta/`, datos)
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
  /** Los nombres de estados y prioridades que usa la empresa. */
  etiquetas() {
    return apiClient.get(`${BASE}/etiquetas/`).then((r) => r.data);
  },
  /** Las solicitudes que esperan el visto bueno de quien entra. */
  aprobaciones() {
    return apiClient.get(`${BASE}/aprobaciones/`).then((r) => r.data);
  },
  decidirAprobacion(id, aprobar, nota = "") {
    return apiClient
      .post(`${BASE}/aprobaciones/${id}/decidir/`, { aprobar, nota })
      .then((r) => r.data);
  },
  /** Lo que pide el alta interna (formulario de la empresa y canales). */
  formularioInterno() {
    return apiClient.get(`${BASE}/tickets/formulario/`).then((r) => r.data);
  },
  /** Las personas registradas, con sus datos, para el alta interna. */
  personas(q = "") {
    return apiClient
      .get(`${BASE}/tickets/personas/`, { params: q ? { q } : {} })
      .then((r) => r.data);
  },
  /** Alta interna: un ticket que llegó por teléfono, WhatsApp o en persona. */
  registrar(campos, archivos) {
    return apiClient
      .post(
        `${BASE}/tickets/registrar/`,
        conArchivos(campos, archivos),
        multipart,
      )
      .then((r) => r.data);
  },
  cambiarPrioridad(id, datos) {
    return apiClient
      .post(`${BASE}/tickets/${id}/prioridad/`, datos)
      .then((r) => r.data);
  },
  /** «Tomar este ticket», desde su ficha. */
  /** El chat del ticket, del lado del técnico a cargo. */
  chatTicket(id) {
    return apiClient.get(`${BASE}/tickets/${id}/chat/`).then((r) => r.data);
  },
  escribirChatTicket(id, texto) {
    return apiClient
      .post(`${BASE}/tickets/${id}/chat/`, { texto })
      .then((r) => r.data);
  },
  tomar(id) {
    return apiClient.post(`${BASE}/tickets/${id}/tomar/`).then((r) => r.data);
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
    /** El orden de criticidad, de menos a más: el primero vale 1. */
    ponderar(recurso, datos) {
      return apiClient
        .post(`${BASE}/config/${recurso}/ponderar/`, datos)
        .then((r) => r.data);
    },
    personas() {
      return apiClient
        .get(`${BASE}/config/tecnicos/personas/`)
        .then((r) => r.data);
    },
    /** Horario hábil, feriados, metas y si los P1 corren 24/7. */
    mesa() {
      return apiClient.get(`${BASE}/config/mesa/`).then((r) => r.data);
    },
    guardarMesa(datos) {
      return apiClient.put(`${BASE}/config/mesa/`, datos).then((r) => r.data);
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
