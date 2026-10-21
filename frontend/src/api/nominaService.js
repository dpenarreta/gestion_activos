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
  /** `conformidad`: "conforme", "observacion" o "conforme_al_cerrar". */
  conformidad(consulta, conformidad, observacion = "") {
    return apiClient
      .post(`${BASE}conformidad/`, { consulta, conformidad, observacion })
      .then((r) => r.data);
  },
  /** Todo lo de un código de empleado, por período (Talento Humano). */
  historial(codigo) {
    return apiClient
      .get("/nomina/historial/", { params: { codigo } })
      .then((r) => r.data);
  },
  /** El PDF de un rol del historial (se vuelve a generar). */
  rolDelHistorial(datos) {
    return apiClient
      .post("/nomina/historial/rol/", datos, { responseType: "blob" })
      .then((r) => r.data);
  },
  // --- Observaciones (Talento Humano) ---------------------------------
  /** `estado`: "abierta", "corregida", "cerrada" o vacío (todas). */
  observaciones(estado = "") {
    return apiClient
      .get("/nomina/observaciones/", { params: estado ? { estado } : {} })
      .then((r) => r.data);
  },
  observacion(id) {
    return apiClient.get(`/nomina/observaciones/${id}/`).then((r) => r.data);
  },
  corregirObservacion(id, nota) {
    return apiClient
      .post(`/nomina/observaciones/${id}/corregir/`, { nota })
      .then((r) => r.data);
  },
  resumenObservaciones() {
    return apiClient.get("/nomina/observaciones/resumen/").then((r) => r.data);
  },
  olvidarCorreo() {
    return apiClient.delete(`${BASE}correo-personal/`);
  },
  configurar(datos) {
    return apiClient.put(`${BASE}configuracion/`, datos).then((r) => r.data);
  },
};
