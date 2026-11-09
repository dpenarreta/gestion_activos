import { apiClient, getAccessToken, getEmpresaActiva } from "./client";

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
  /** Lo que muestra «Soporte TI → Nuevo ticket», con «Mi perfil».
   * `desdeLaMesa`: el mismo formulario desde la Mesa de ayuda, que pide
   * `soporte.mesa_crear` en vez de `soporte.crear` (09/11/2026). */
  solicitar({ desdeLaMesa = false } = {}) {
    return apiClient
      .get(`${BASE}/${desdeLaMesa ? "mesa/" : ""}solicitar/`)
      .then((r) => r.data);
  },
  crearTicket(campos, archivos, { desdeLaMesa = false } = {}) {
    return apiClient
      .post(
        `${BASE}/${desdeLaMesa ? "mesa/" : ""}solicitar/`,
        conArchivos(campos, archivos),
        multipart,
      )
      .then((r) => r.data);
  },
  misTickets() {
    return apiClient.get(`${BASE}/mis-tickets/`).then((r) => r.data);
  },
  /** «Mis solicitudes» de la bandeja de la Mesa: los mismos tickets, con
   * `soporte.mesa_mis_tickets` (09/11/2026). */
  misSolicitudesEnLaMesa() {
    return apiClient.get(`${BASE}/mesa/mis-solicitudes/`).then((r) => r.data);
  },
  /** `sondeo`: la consulta que la ficha abierta repite sola (va con su
   * propio límite en el servidor, no con el general de la persona). */
  miTicket(id, { sondeo = false } = {}) {
    return apiClient
      .get(`${BASE}/mis-tickets/${id}/`, {
        params: sondeo ? { sondeo: 1 } : undefined,
      })
      .then((r) => r.data);
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
  /** La llamada de voz del ticket: la señalización (el audio va directo). */
  llamar(ticket, oferta) {
    return apiClient
      .post(`${BASE}/llamadas/`, { ticket, oferta })
      .then((r) => r.data);
  },
  llamadasEntrantes() {
    return apiClient.get(`${BASE}/llamadas/`).then((r) => r.data);
  },
  llamada(id) {
    return apiClient.get(`${BASE}/llamadas/${id}/`).then((r) => r.data);
  },
  contestarLlamada(id, respuesta) {
    return apiClient
      .post(`${BASE}/llamadas/${id}/contestar/`, { respuesta })
      .then((r) => r.data);
  },
  colgarLlamada(id) {
    return apiClient.post(`${BASE}/llamadas/${id}/colgar/`).then((r) => r.data);
  },
  /** Colgar al cerrar o recargar la pestaña: la petición sale aunque la
   * página se esté yendo (con `keepalive`). */
  colgarAlSalir(id) {
    const token = getAccessToken();
    const empresa = getEmpresaActiva();
    try {
      fetch(`${apiClient.defaults.baseURL}${BASE}/llamadas/${id}/colgar/`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(empresa ? { "X-Empresa": empresa } : {}),
        },
      });
    } catch {
      // Si no sale, el servidor la corta solo al dejar de recibir señales.
    }
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
  ticket(id, { sondeo = false } = {}) {
    return apiClient
      .get(`${BASE}/tickets/${id}/`, {
        params: sondeo ? { sondeo: 1 } : undefined,
      })
      .then((r) => r.data);
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
