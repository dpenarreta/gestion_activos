import { mensajeDeError } from "../utils/errores";
import { descargarBlob } from "../utils/descargas";
import { apiClient } from "./client";

const BASE = "/novedades";

/** Quita de la consulta lo vacío: el servidor trata «» distinto de «ausente»
 * (sin `supervisor` es «Todos los supervisores»). */
function limpio(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, valor]) => valor !== undefined && valor !== null && valor !== "",
    ),
  );
}

const datos = (r) => r.data;

/**
 * El error de una llamada del módulo, ya legible y con lo que la pantalla
 * necesita para decidir: el código (`period_closed`, `conflict`,
 * `deadline_passed`…), el estado HTTP y el detalle (las celdas rechazadas de
 * Días laborados, los campos de un formulario). La lógica decide por
 * `codigo`, nunca por el texto.
 *
 * El texto: el mensaje del servidor, que ya dice el motivo exacto («El
 * período Octubre 2026 está cerrado…»). Solo cuando el detalle es por campo
 * de un formulario (validación del serializer) se arma con esos campos.
 */
export function errorDeNovedades(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  const respuesta = err?.response;
  const cuerpo = respuesta?.data?.error;
  const detalle = cuerpo?.details ?? null;
  const estructurado =
    detalle &&
    (Array.isArray(detalle.cells) || detalle.fields || detalle.record_id);
  let mensaje;
  if (!respuesta) {
    mensaje = "Sin conexión con el servidor. Revise su red e intente de nuevo.";
  } else if (estructurado && cuerpo?.message) {
    mensaje = cuerpo.message;
  } else {
    mensaje = mensajeDeError(err, porDefecto);
  }
  return {
    mensaje,
    codigo: cuerpo?.code ?? null,
    estado: respuesta?.status ?? 0,
    detalle,
  };
}

/** Solo se reintenta solo lo que puede resolverse sin la persona: red caída,
 * servidor reiniciándose o saturado. Un rechazo de reglas (fecha futura,
 * plazo vencido, período cerrado, permisos, conflicto) necesita que alguien
 * lo corrija. */
export function esReintentable(estado) {
  return estado === 0 || estado === 408 || estado === 429 || estado >= 500;
}

/** El nombre que manda el servidor en `Content-Disposition`. */
function nombreDelArchivo(cabecera, porDefecto) {
  const encontrado = /filename="?([^";]+)"?/i.exec(cabecera ?? "");
  return encontrado?.[1] ?? porDefecto;
}

/**
 * Las exportaciones a Excel son descargas (lo demás del módulo se ve dentro
 * del sistema). El archivo se pide con la sesión y se guarda con
 * `descargarBlob`, que además deja registro de la descarga. Si el servidor
 * responde con error, el cuerpo llega como blob y se lee para mostrar su
 * mensaje.
 */
async function descargar(ruta, params, porDefecto) {
  try {
    const r = await apiClient.get(`${BASE}/${ruta}`, {
      params: limpio(params),
      responseType: "blob",
    });
    descargarBlob(
      r.data,
      nombreDelArchivo(r.headers?.["content-disposition"], porDefecto),
    );
  } catch (err) {
    const cuerpo = err?.response?.data;
    if (typeof Blob !== "undefined" && cuerpo instanceof Blob) {
      try {
        const leido = JSON.parse(await cuerpo.text());
        throw { response: { ...err.response, data: leido } };
      } catch (convertido) {
        if (convertido?.response) throw convertido;
      }
    }
    throw err;
  }
}

/** Control Operativo de Novedades (Gestión Humana). Contrato: `/api/v1/novedades/`. */
export const novedadesService = {
  // --- Quién es y qué puede, y los selectores de arriba ---
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),
  supervisores: () => apiClient.get(`${BASE}/supervisors/`).then(datos),
  periodos: (supervisor) =>
    apiClient
      .get(`${BASE}/periods/`, { params: limpio({ supervisor }) })
      .then(datos),
  estadoDePeriodos: (period) =>
    apiClient
      .get(`${BASE}/periods/status/`, { params: limpio({ period }) })
      .then(datos),
  mesesDeHorasExtras: (supervisor) =>
    apiClient
      .get(`${BASE}/overtime/months/`, { params: limpio({ supervisor }) })
      .then(datos),

  // --- Días laborados ---
  matriz: (period, supervisor) =>
    apiClient
      .get(`${BASE}/worked-days/`, { params: limpio({ period, supervisor }) })
      .then(datos),
  guardarCeldas: (period, supervisorId, cells) =>
    apiClient
      .post(`${BASE}/worked-days/save/`, {
        period,
        supervisor_id: supervisorId,
        cells,
      })
      .then(datos),
  resumenDeCierre: (period, supervisor) =>
    apiClient
      .get(`${BASE}/periods/close-summary/`, {
        params: limpio({ period, supervisor }),
      })
      .then(datos),
  cerrarPeriodo: (period, supervisorId) =>
    apiClient
      .post(`${BASE}/periods/close/`, {
        period,
        supervisor_id: supervisorId,
        confirm: true,
      })
      .then(datos),
  exportarDias: (period, supervisor) =>
    descargar(
      "worked-days/export/",
      { period, supervisor },
      `dias-laborados-${period}.xlsx`,
    ),
  plantillaDias: (period, supervisor) =>
    descargar(
      "worked-days/template/",
      { period, supervisor },
      `plantilla-dias-laborados-${period}.xlsx`,
    ),
  corregirDia: (cuerpo) =>
    apiClient.post(`${BASE}/corrections/worked-day/`, cuerpo).then(datos),

  // --- Horas extras ---
  horasExtras: (params) =>
    apiClient.get(`${BASE}/overtime/`, { params: limpio(params) }).then(datos),
  crearHorasExtras: (cuerpo) =>
    apiClient.post(`${BASE}/overtime/`, cuerpo).then(datos),
  editarHorasExtras: (id, cuerpo) =>
    apiClient.patch(`${BASE}/overtime/${id}/`, cuerpo).then(datos),
  eliminarHorasExtras: (id, reason = "") =>
    apiClient
      .delete(`${BASE}/overtime/${id}/`, { data: { reason } })
      .then(datos),
  guardarLoteHorasExtras: (period, rows) =>
    apiClient.post(`${BASE}/overtime/bulk/`, { period, rows }).then(datos),
  revisionAntesDeCerrarMes: (period, supervisor) =>
    apiClient
      .get(`${BASE}/overtime/months/check/`, {
        params: limpio({ period, supervisor }),
      })
      .then(datos),
  cerrarMes: (period, supervisorId) =>
    apiClient
      .post(`${BASE}/overtime/months/close/`, {
        period,
        supervisor_id: supervisorId,
        confirm: true,
      })
      .then(datos),
  exportarHorasExtras: (params) =>
    descargar(
      "overtime/export/",
      params,
      `horas-extras-${params?.period || "consolidado"}.xlsx`,
    ),
  plantillaHorasExtras: () =>
    descargar("overtime/template/", {}, "plantilla-horas-extras.xlsx"),
  corregirHorasExtras: (cuerpo) =>
    apiClient.post(`${BASE}/corrections/overtime/`, cuerpo).then(datos),

  // --- Colaboradores ---
  colaboradores: (params) =>
    apiClient
      .get(`${BASE}/collaborators/`, { params: limpio(params) })
      .then(datos),
  crearColaborador: (cuerpo) =>
    apiClient.post(`${BASE}/collaborators/`, cuerpo).then(datos),
  editarColaborador: (id, cuerpo) =>
    apiClient.patch(`${BASE}/collaborators/${id}/`, cuerpo).then(datos),
  eliminarColaborador: (id, reason) =>
    apiClient
      .delete(`${BASE}/collaborators/${id}/`, { data: { reason } })
      .then(datos),
  cambiarEstado: (id, status, reason) =>
    apiClient
      .post(`${BASE}/collaborators/${id}/status/`, { status, reason })
      .then(datos),
  retirarDeDias: (id, reason) =>
    apiClient
      .post(`${BASE}/collaborators/${id}/remove-worked-days/`, { reason })
      .then(datos),
  restaurarEnDias: (id, reason) =>
    apiClient
      .post(`${BASE}/collaborators/${id}/restore-worked-days/`, { reason })
      .then(datos),
  corregirCedula: (id, cedula, reason) =>
    apiClient
      .post(`${BASE}/collaborators/${id}/cedula/`, { cedula, reason })
      .then(datos),
  reasignar: (id, supervisorId, reason) =>
    apiClient
      .post(`${BASE}/collaborators/${id}/reassign/`, {
        supervisor_id: supervisorId,
        reason,
      })
      .then(datos),
  /** El detalle de un colaborador: el único lugar (además del Excel y de
   * la corrección) donde el servidor manda la cédula completa, y solo a
   * quien puede verla. */
  colaborador: (id) =>
    apiClient.get(`${BASE}/collaborators/${id}/`).then(datos),
  historialDeColaborador: (id) =>
    apiClient.get(`${BASE}/collaborators/${id}/history/`).then(datos),
  plantillaColaboradores: () =>
    descargar(
      "collaborators/template/",
      {},
      "plantilla-base-colaboradores.xlsx",
    ),

  // --- Importación en dos pasos: vista previa y confirmación ---
  vistaPrevia: ({ kind, period, supervisorId, archivo }) => {
    const formulario = new FormData();
    formulario.append("kind", kind);
    if (period) formulario.append("period", period);
    if (supervisorId) formulario.append("supervisor_id", String(supervisorId));
    formulario.append("file", archivo);
    return apiClient.post(`${BASE}/imports/preview/`, formulario).then(datos);
  },
  confirmarImportacion: (id, strategy) =>
    apiClient.post(`${BASE}/imports/${id}/confirm/`, { strategy }).then(datos),
  cancelarImportacion: (id) =>
    apiClient.post(`${BASE}/imports/${id}/cancel/`).then(datos),
  erroresDeImportacion: (id) =>
    descargar(`imports/${id}/errors/`, {}, `errores-importacion-${id}.xlsx`),

  // --- Historial y repositorio ---
  historial: (params) =>
    apiClient.get(`${BASE}/history/`, { params: limpio(params) }).then(datos),
  repositorio: () => apiClient.get(`${BASE}/repository/`).then(datos),

  // --- Horas depuradas ---
  depuracion: (period) =>
    apiClient
      .get(`${BASE}/depuration/`, { params: limpio({ period }) })
      .then(datos),
  crearDepuracion: (period) =>
    apiClient
      .post(`${BASE}/depuration/create/`, { period, confirm: true })
      .then(datos),
  filasDepuradas: (period) =>
    apiClient
      .get(`${BASE}/depuration/rows/`, { params: limpio({ period }) })
      .then(datos),
  guardarDepuradas: (period, rows) =>
    apiClient
      .post(`${BASE}/depuration/rows/save/`, { period, rows })
      .then(datos),
  historialDepuracion: (period, row) =>
    apiClient
      .get(`${BASE}/depuration/history/`, { params: limpio({ period, row }) })
      .then(datos),
  exportarDepuradas: (period) =>
    descargar(
      "depuration/export/",
      { period },
      `horas-depuradas-${period}.xlsx`,
    ),

  // --- Ingresos y salidas (con sus propios permisos) ---
  accesoMovimientos: () =>
    apiClient.get(`${BASE}/movements/access/`).then(datos),
  opcionesMovimientos: () =>
    apiClient.get(`${BASE}/movements/options/`).then(datos),
  movimientos: (tipo, params) =>
    apiClient
      .get(`${BASE}/movements/${tipo}/`, { params: limpio(params) })
      .then(datos),
  exportarMovimientos: (tipo, params) =>
    descargar(
      `movements/${tipo}/export/`,
      params,
      `${tipo === "entries" ? "ingresos" : "salidas"}.xlsx`,
    ),

  // --- Configuración del módulo ---
  plazos: () => apiClient.get(`${BASE}/deadlines/settings/`).then(datos),
  guardarPlazos: (cambios) =>
    apiClient.patch(`${BASE}/deadlines/settings/`, cambios).then(datos),
  plazoDeMes: () => apiClient.get(`${BASE}/overtime/settings/`).then(datos),
  guardarPlazoDeMes: (graceHours) =>
    apiClient
      .patch(`${BASE}/overtime/settings/`, { grace_hours: graceHours })
      .then(datos),
  permisosPorRol: () =>
    apiClient.get(`${BASE}/permissions/config/`).then(datos),
  cambiarPermisoDeRol: (cuerpo) =>
    apiClient.post(`${BASE}/permissions/roles/`, cuerpo).then(datos),
  usuariosOperativos: () =>
    apiClient.get(`${BASE}/permissions/users/`).then(datos),
  permisosEfectivos: (userId) =>
    apiClient.get(`${BASE}/permissions/effective/${userId}/`).then(datos),
  excepciones: () =>
    apiClient.get(`${BASE}/permissions/overrides/`).then(datos),
  crearExcepcion: (cuerpo) =>
    apiClient.post(`${BASE}/permissions/overrides/`, cuerpo).then(datos),
  revocarExcepcion: (id, reason) =>
    apiClient
      .post(`${BASE}/permissions/overrides/${id}/revoke/`, { reason })
      .then(datos),
  destinatarios: () =>
    apiClient.get(`${BASE}/collaborator-notifications/recipients/`).then(datos),
  crearDestinatario: (cuerpo) =>
    apiClient
      .post(`${BASE}/collaborator-notifications/recipients/`, cuerpo)
      .then(datos),
  editarDestinatario: (id, cuerpo) =>
    apiClient
      .patch(`${BASE}/collaborator-notifications/recipients/${id}/`, cuerpo)
      .then(datos),
  correosEnviados: () =>
    apiClient.get(`${BASE}/collaborator-notifications/events/`).then(datos),
  reintentarCorreo: (tipo, id) =>
    apiClient
      .post(`${BASE}/collaborator-notifications/events/${tipo}/${id}/retry/`)
      .then(datos),
  permisosDeMovimientos: (q) =>
    apiClient
      .get(`${BASE}/movements/permissions/`, { params: limpio({ q }) })
      .then(datos),
  cambiarPermisoDeMovimientos: (userId, cambios) =>
    apiClient
      .post(`${BASE}/movements/permissions/${userId}/`, cambios)
      .then(datos),
};
