import { apiClient } from "./client";

const BASE = "/organizacion/";

/** El motivo de un cambio al organigrama (bitácora, 26/10/2026): va en un
 * encabezado, codificado para que lleve tildes. */
function conMotivo(motivo) {
  return motivo
    ? { headers: { "X-Motivo-Cambio": encodeURIComponent(motivo) } }
    : {};
}

/** Lo que se arma del organigrama: niveles, unidades y cargos. */
const RECURSOS = {
  niveles: `${BASE}niveles/`,
  unidades: `${BASE}unidades/`,
  cargos: `${BASE}cargos/`,
};

/**
 * Módulo Institucional: el organigrama de la empresa activa, su estructura y
 * quién ocupa cada cargo.
 */
export const institucionalService = {
  /** Todo el organigrama, plano: niveles, unidades y cargos con ocupantes. */
  organigrama() {
    return apiClient.get(`${BASE}organigrama/`).then((res) => res.data);
  },
  crear(recurso, datos, motivo) {
    return apiClient
      .post(RECURSOS[recurso], datos, conMotivo(motivo))
      .then((res) => res.data);
  },
  actualizar(recurso, id, datos, motivo) {
    return apiClient
      .patch(`${RECURSOS[recurso]}${id}/`, datos, conMotivo(motivo))
      .then((res) => res.data);
  },
  eliminar(recurso, id, motivo) {
    return apiClient.delete(`${RECURSOS[recurso]}${id}/`, conMotivo(motivo));
  },
  // --- Bitácora del organigrama (26/10/2026) ---------------------------
  /** Las 2 últimas versiones: quién, cuándo, IP, motivo y qué cambió. */
  versionesOrganigrama() {
    return apiClient
      .get(`${BASE}organigrama/versiones/`)
      .then((res) => res.data);
  },
  /** Qué cambiaría al revertir esa versión. */
  vistaPreviaRevertir(id) {
    return apiClient
      .get(`${BASE}organigrama/versiones/${id}/revertir/`)
      .then((res) => res.data.cambios);
  },
  revertirVersion(id, motivo) {
    return apiClient
      .post(
        `${BASE}organigrama/versiones/${id}/revertir/`,
        {},
        conMotivo(motivo),
      )
      .then((res) => res.data);
  },
  /** Las personas de la empresa con su cargo (`q` filtra por nombre). */
  asignaciones(q = "") {
    return apiClient
      .get(`${BASE}asignaciones/`, { params: q ? { q } : {} })
      .then((res) => res.data);
  },
  /** El perfil de un cargo: objetivo, funciones, competencias y KPIs. */
  perfilCargo(id) {
    return apiClient.get(`${BASE}cargos/${id}/perfil/`).then((res) => res.data);
  },
  /** Funciones, competencias y KPIs van como texto, uno por línea. */
  guardarPerfilCargo(id, datos, motivo) {
    return apiClient
      .put(`${BASE}cargos/${id}/perfil/`, datos, conMotivo(motivo))
      .then((res) => res.data);
  },
  /** La plantilla .xlsx del organigrama por unidad, para cargar personas. */
  plantillaPersonas() {
    return apiClient
      .get(`${BASE}carga-personas/plantilla/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  /** El organigrama completo (.xlsx): estructura, personas y resumen. */
  exportarOrganigrama() {
    return apiClient
      .get(`${BASE}organigrama/exportar/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  /** Sube la plantilla llena: sin `confirmar` solo la valida. */
  cargarPersonas(archivo, { confirmar = false, motivo } = {}) {
    const datos = new FormData();
    datos.append("archivo", archivo);
    datos.append("confirmar", confirmar ? "true" : "false");
    return apiClient
      .post(`${BASE}carga-personas/`, datos, conMotivo(motivo))
      .then((res) => res.data);
  },
  // --- Códigos de conducta y reglamentos ---------------------------------
  documentos() {
    return apiClient.get(`${BASE}documentos/`).then((res) => res.data);
  },
  /** Publica (o, con `id`, edita) un documento; `archivo` es opcional al
   * editar. Va como formulario multipart por el archivo. */
  guardarDocumento(id, campos, archivo) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) datos.append(clave, valor);
    });
    if (archivo) datos.append("archivo", archivo);
    const pedido = id
      ? apiClient.patch(`${BASE}documentos/${id}/`, datos)
      : apiClient.post(`${BASE}documentos/`, datos);
    return pedido.then((res) => res.data);
  },
  eliminarDocumento(id) {
    return apiClient.delete(`${BASE}documentos/${id}/`);
  },
  /** El archivo, como blob (no tiene URL pública). */
  archivoDocumento(id) {
    return apiClient
      .get(`${BASE}documentos/${id}/archivo/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  // --- Acuerdo de confidencialidad ------------------------------------
  /** El acuerdo y si la persona ya lo aceptó para los documentos vigentes. */
  confidencialidad() {
    return apiClient.get(`${BASE}confidencialidad/`).then((res) => res.data);
  },
  aceptarConfidencialidad() {
    return apiClient
      .post(`${BASE}confidencialidad/aceptar/`)
      .then((res) => res.data);
  },
  guardarConfidencialidad(datos) {
    return apiClient
      .put(`${BASE}confidencialidad/`, datos)
      .then((res) => res.data);
  },
  aceptacionesConfidencialidad() {
    return apiClient
      .get(`${BASE}confidencialidad/aceptaciones/`)
      .then((res) => res.data);
  },
  // --- Carrusel de noticias de Inicio ------------------------------------
  /** Las vigentes hoy; con `todas`, también las programadas y vencidas. */
  noticias(todas = false) {
    return apiClient
      .get(`${BASE}noticias/`, { params: todas ? { todas: 1 } : {} })
      .then((res) => res.data);
  },
  guardarNoticia(id, campos, imagen) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) datos.append(clave, valor);
    });
    if (imagen) datos.append("imagen", imagen);
    const pedido = id
      ? apiClient.patch(`${BASE}noticias/${id}/`, datos)
      : apiClient.post(`${BASE}noticias/`, datos);
    return pedido.then((res) => res.data);
  },
  eliminarNoticia(id) {
    return apiClient.delete(`${BASE}noticias/${id}/`);
  },
  /** La imagen, como blob (no tiene URL pública). */
  imagenNoticia(id) {
    return apiClient
      .get(`${BASE}noticias/${id}/imagen/`, { responseType: "blob" })
      .then((res) => res.data);
  },
  carrusel() {
    return apiClient.get(`${BASE}carrusel/`).then((res) => res.data);
  },
  guardarCarrusel(segundos) {
    return apiClient
      .put(`${BASE}carrusel/`, { segundos })
      .then((res) => res.data);
  },
  // --- Calendario de Inicio ----------------------------------------------
  /** Lo que hay entre dos fechas (AAAA-MM-DD), con las anuales de cada año. */
  calendario(desde, hasta) {
    return apiClient
      .get(`${BASE}calendario/`, { params: { desde, hasta } })
      .then((res) => res.data);
  },
  /** Las fechas cargadas, para gestionarlas. */
  eventos() {
    return apiClient.get(`${BASE}eventos/`).then((res) => res.data);
  },
  guardarEvento(id, datos) {
    const pedido = id
      ? apiClient.patch(`${BASE}eventos/${id}/`, datos)
      : apiClient.post(`${BASE}eventos/`, datos);
    return pedido.then((res) => res.data);
  },
  eliminarEvento(id) {
    return apiClient.delete(`${BASE}eventos/${id}/`);
  },
  // --- Vacaciones ---------------------------------------------------------
  /** Mis días de vacaciones, por período. */
  misVacaciones() {
    return apiClient.get(`${BASE}vacaciones/mias/`).then((res) => res.data);
  },
  /** Con `vacaciones.ver_todas`: las personas con sus días pendientes. */
  personasVacaciones(q = "") {
    return apiClient
      .get(`${BASE}vacaciones/`, { params: q ? { q } : {} })
      .then((res) => res.data);
  },
  /** Con `vacaciones.ver_todas`: las vacaciones de una persona. */
  vacacionesDe(usuario) {
    return apiClient
      .get(`${BASE}vacaciones/`, { params: { usuario } })
      .then((res) => res.data);
  },
  /** Pone a la persona en el cargo; `cargo` vacío la saca. */
  asignar(usuario, cargo, motivo) {
    return apiClient
      .post(
        `${BASE}asignaciones/`,
        { usuario, cargo: cargo || null },
        conMotivo(motivo),
      )
      .then((res) => res.data);
  },
};
