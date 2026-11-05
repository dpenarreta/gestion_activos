import { mensajeDeError } from "../utils/errores";
import { descargarBlob } from "../utils/descargas";
import { apiClient } from "./client";

const BASE = "/tasks";

const datos = (r) => r.data;

/** Quita de la consulta lo vacío (el servidor ignora los filtros vacíos,
 * pero así la dirección queda limpia). */
function limpio(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, valor]) => valor !== undefined && valor !== null && valor !== "",
    ),
  );
}

/** El primer mensaje de un detalle por campo (`{campo: ["…"]}`). */
function primero(valor) {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) {
    for (const v of valor) {
      const m = primero(v);
      if (m) return m;
    }
  }
  if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) {
      const m = primero(v);
      if (m) return m;
    }
  }
  return null;
}

/**
 * El error de una llamada de Tareas, ya legible y con lo que la pantalla
 * necesita para decidir: el código (`own_task`, `fija_limit`,
 * `schedule_overlap`, `already_closed`, `assignee_out_of_scope`…), el estado
 * HTTP y los errores por campo para ponerlos bajo cada control. La lógica
 * decide por `codigo`, nunca por el texto.
 *
 * El servidor ya pone en `message` el primer motivo concreto (ver
 * `TareasView.handle_exception`), que es lo que la persona puede corregir.
 */
export function errorDeTareas(
  err,
  porDefecto = "No se pudo completar la acción.",
) {
  const respuesta = err?.response;
  const cuerpo = respuesta?.data?.error;
  const detalle = cuerpo?.details ?? null;
  const campos = {};
  if (detalle && typeof detalle === "object" && !Array.isArray(detalle)) {
    for (const [campo, valor] of Object.entries(detalle)) {
      const m = primero(valor);
      if (m && campo !== "non_field_errors") campos[campo] = m;
    }
  }
  let mensaje;
  if (!respuesta) {
    mensaje = "Sin conexión con el servidor. Revise su red e intente de nuevo.";
  } else if (respuesta.status === 404 && !cuerpo?.message) {
    mensaje =
      "No se encontró: es posible que ya no exista o que no tenga acceso.";
  } else if (cuerpo?.message && cuerpo.message !== "Error en la solicitud.") {
    mensaje = cuerpo.message;
  } else {
    mensaje = mensajeDeError(err, porDefecto);
  }
  return {
    mensaje,
    codigo: cuerpo?.code ?? null,
    estado: respuesta?.status ?? 0,
    campos,
  };
}

/** El nombre que manda el servidor en `Content-Disposition`. */
function nombreDelArchivo(cabecera, porDefecto) {
  const encontrado = /filename="?([^";]+)"?/i.exec(cabecera ?? "");
  return encontrado?.[1] ?? porDefecto;
}

/**
 * Tareas y Equipo (Gestión Humana). Contrato: `/api/v1/tasks/`. El servidor
 * vuelve a autorizar cada petición (permisos del catálogo y ámbito por el
 * organigrama): ocultar un botón aquí nunca es la barrera.
 */
export const tareasService = {
  // --- Quién es y qué puede ---
  yo: () => apiClient.get(`${BASE}/me/`).then(datos),
  asignables: () => apiClient.get(`${BASE}/assignable-users/`).then(datos),
  ajustes: () => apiClient.get(`${BASE}/settings/`).then(datos),
  guardarAjustes: (valores) =>
    apiClient.patch(`${BASE}/settings/`, valores).then(datos),

  // --- Tareas ---
  listar: () => apiClient.get(`${BASE}/`).then(datos),
  obtener: (id) => apiClient.get(`${BASE}/${id}/`).then(datos),
  crear: (valores) => apiClient.post(`${BASE}/`, valores).then(datos),
  actualizar: (id, valores) =>
    apiClient.patch(`${BASE}/${id}/`, valores).then(datos),
  eliminar: (id) => apiClient.delete(`${BASE}/${id}/`),
  corregirArchivada: (id, valores) =>
    apiClient.patch(`${BASE}/${id}/correct/`, valores).then(datos),

  // --- Comentarios de la tarea (leerlos los marca como vistos) ---
  comentarios: (id) => apiClient.get(`${BASE}/${id}/comments/`).then(datos),
  comentar: (id, text) =>
    apiClient.post(`${BASE}/${id}/comments/`, { text }).then(datos),

  // --- Registro de horas ---
  actividades: (id) => apiClient.get(`${BASE}/${id}/activities/`).then(datos),
  registrarActividad: (id, valores) =>
    apiClient.post(`${BASE}/${id}/activities/`, valores).then(datos),
  registrarRetroactiva: (id, valores) =>
    apiClient
      .post(`${BASE}/${id}/activities/retroactive/`, valores)
      .then(datos),
  editarActividad: (tareaId, actividadId, valores) =>
    apiClient
      .patch(`${BASE}/${tareaId}/activities/${actividadId}/`, valores)
      .then(datos),
  eliminarActividad: (tareaId, actividadId) =>
    apiClient.delete(`${BASE}/${tareaId}/activities/${actividadId}/`),
  comentariosDeActividad: (tareaId, actividadId) =>
    apiClient
      .get(`${BASE}/${tareaId}/activities/${actividadId}/comments/`)
      .then(datos),
  comentarActividad: (tareaId, actividadId, text) =>
    apiClient
      .post(`${BASE}/${tareaId}/activities/${actividadId}/comments/`, { text })
      .then(datos),
  agendaDelDia: (fecha) =>
    apiClient
      .get(`${BASE}/activities/day-schedule/`, {
        params: limpio({ date: fecha }),
      })
      .then(datos),
  motivos: () => apiClient.get(`${BASE}/activity-reasons/`).then(datos),
  crearMotivo: (valores) =>
    apiClient.post(`${BASE}/activity-reasons/`, valores).then(datos),
  actualizarMotivo: (id, valores) =>
    apiClient.patch(`${BASE}/activity-reasons/${id}/`, valores).then(datos),

  // --- Tiempo Objetivo y Fecha Fin ---
  tiempoObjetivo: (id) =>
    apiClient.get(`${BASE}/${id}/target-time/`).then(datos),
  validarTiempoObjetivo: (id, valores) =>
    apiClient.post(`${BASE}/${id}/target-time/`, valores).then(datos),
  fechaFin: (id) => apiClient.get(`${BASE}/${id}/end-date/`).then(datos),
  decidirFechaFin: (id, valores) =>
    apiClient.post(`${BASE}/${id}/end-date/`, valores).then(datos),
  pendientes: ({ usuario, rol, tipo } = {}) =>
    apiClient
      .get(`${BASE}/validations/pending/`, {
        params: limpio({ user_id: usuario, role: rol, type: tipo }),
      })
      .then(datos),
  validarEnBloque: (valores) =>
    apiClient.post(`${BASE}/target-time/bulk-validate/`, valores).then(datos),
  aprobarFechasEnBloque: (valores) =>
    apiClient.post(`${BASE}/end-date/bulk-approve/`, valores).then(datos),

  // --- Cierre de mes y repositorio ---
  vistaPreviaDelCierre: ({ year, month, cutoffDate } = {}) =>
    apiClient
      .get(`${BASE}/close-month/`, {
        params: limpio({ year, month, cutoffDate }),
      })
      .then(datos),
  cerrarMes: (valores) =>
    apiClient.post(`${BASE}/close-month/`, valores).then(datos),
  repositorio: () => apiClient.get(`${BASE}/repository/`).then(datos),
  repositorioDelMes: (year, month) =>
    apiClient.get(`${BASE}/repository/${year}/${month}/`).then(datos),

  // --- Importación por Excel ---
  importar: (archivo) => {
    const formulario = new FormData();
    formulario.append("file", archivo);
    return apiClient.post(`${BASE}/import/`, formulario).then(datos);
  },
  /** La plantilla es una descarga: se pide con la sesión y se guarda con
   * `descargarBlob`, que además deja registro. */
  descargarPlantilla: async () => {
    const r = await apiClient.get(`${BASE}/template/`, {
      responseType: "blob",
    });
    descargarBlob(
      r.data,
      nombreDelArchivo(
        r.headers?.["content-disposition"],
        "plantilla_tareas.xlsx",
      ),
    );
  },

  // --- Equipo ---
  equipo: () => apiClient.get(`${BASE}/team/`).then(datos),
  tareasDe: (usuarioId) =>
    apiClient.get(`${BASE}/team/${usuarioId}/tasks/`).then(datos),
};
