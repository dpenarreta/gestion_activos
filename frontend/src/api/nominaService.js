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
  // --- Descarga masiva por área (Talento Humano) -----------------------
  areasDescargaMasiva() {
    return apiClient.get(`${BASE}descarga-masiva/`).then((r) => r.data);
  },
  /** `{ unidad, anio, mes, password }`: devuelve el ZIP y cuántos roles
   * trae (y cuántas personas quedaron sin rol). */
  descargaMasiva(datos) {
    return apiClient
      .post(`${BASE}descarga-masiva/`, datos, { responseType: "blob" })
      .then((r) => {
        const numero = (clave) => {
          const valor = r.headers?.[clave];
          return valor == null ? null : Number(valor);
        };
        return {
          blob: r.data,
          incluidos: numero("x-incluidos"),
          omitidos: numero("x-omitidos"),
        };
      });
  },
  // --- Rol auditado (Talento Humano) ---------------------------------
  /** La persona del código y los meses con movimientos. */
  personaAuditada(codigo) {
    return apiClient
      .get(`${BASE}auditado/`, { params: { codigo } })
      .then((r) => r.data);
  },
  /** `{ codigo, periodos: [{anio, mes}], password }`: un PDF (un mes) o un
   * ZIP (varios), con el rol y su constancia. */
  rolAuditado(datos) {
    return apiClient
      .post(`${BASE}auditado/`, datos, { responseType: "blob" })
      .then((r) => ({
        blob: r.data,
        incluidos: Number(r.headers?.["x-incluidos"] ?? 0),
        omitidos: Number(r.headers?.["x-omitidos"] ?? 0),
      }));
  },
  // --- Roles sin abrir (Talento Humano) -------------------------------
  /** De las personas habilitadas, quiénes abrieron o no su rol del mes. */
  seguimiento(anio, mes) {
    return apiClient
      .get(`${BASE}seguimiento/`, { params: { anio, mes } })
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
  /** La respuesta de Talento Humano, con imágenes o archivos opcionales. */
  corregirObservacion(id, nota, archivos = []) {
    const datos = new FormData();
    datos.append("nota", nota);
    archivos.forEach((archivo) => datos.append("archivos", archivo));
    return apiClient
      .post(`/nomina/observaciones/${id}/corregir/`, datos)
      .then((r) => r.data);
  },
  /** Un adjunto de una respuesta (para verlo o descargarlo). */
  adjuntoObservacion(id) {
    return apiClient
      .get(`/nomina/observaciones/adjuntos/${id}/`, { responseType: "blob" })
      .then((r) => r.data);
  },
  resumenObservaciones() {
    return apiClient.get("/nomina/observaciones/resumen/").then((r) => r.data);
  },
  // --- Lista de habilitados (nómina) y mis observaciones ---------------
  habilitados(q = "") {
    return apiClient
      .get(`${BASE}habilitados/`, { params: q ? { q } : {} })
      .then((r) => r.data);
  },
  /** `{ usuario, habilitado, codigo }`: devuelve la fila guardada. */
  habilitar(datos) {
    return apiClient.post(`${BASE}habilitados/`, datos).then((r) => r.data);
  },
  misObservaciones() {
    return apiClient.get(`${BASE}mis-observaciones/`).then((r) => r.data);
  },
  olvidarCorreo() {
    return apiClient.delete(`${BASE}correo-personal/`);
  },
  configurar(datos) {
    return apiClient.put(`${BASE}configuracion/`, datos).then((r) => r.data);
  },
};
