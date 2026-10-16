import { createApiClient } from './httpClient'

const api = createApiClient('/api/dashboards')

export function obtenerLayout(dashboardId) {
  return api.get(`/${dashboardId}/layout`).then((r) => r.data)
}

/** El autor del cambio lo resuelve el backend desde el usuario autenticado (nunca se envía
 * desde acá: era falsificable, ver `cartera/dashboard_views.py::_etiqueta_actor`).
 *
 * `passwordConfirmacion` solo viaja cuando el dashboard tiene el diseño bloqueado y la persona
 * acaba de escribir su contraseña para autorizar ESTE cambio (`services/desbloqueo.py`). Va en el
 * cuerpo y no en la URL, y el nombre del campo contiene "password" a propósito: es lo que hace
 * que el enmascarado de auditoría del backend la reconozca y no la registre. */
export function guardarLayout(dashboardId, { version, components, passwordConfirmacion }) {
  return api.put(`/${dashboardId}/layout`, {
    version, components, ...cuerpoConfirmacion(passwordConfirmacion),
  }).then((r) => r.data)
}

export function restablecerLayout(dashboardId, { passwordConfirmacion } = {}) {
  return api.post(`/${dashboardId}/layout/reset`, cuerpoConfirmacion(passwordConfirmacion)).then((r) => r.data)
}

/**
 * El campo solo aparece en el cuerpo si hay una contraseña de verdad.
 *
 * La comprobación es `typeof === 'string'` y no un simple truthy por un caso real: un handler
 * escrito como `onClick={guardar}` le pasa a la operación el EVENTO de React como primer
 * argumento, que llegaba hasta acá como si fuera la contraseña. Axios entonces intentaba
 * serializar ese objeto —que es circular— y reventaba ANTES de hacer la petición: la pantalla
 * mostraba "No se pudo guardar la configuración", sin cuadro de contraseña, sin request y sin
 * nada en el log del servidor.
 */
function cuerpoConfirmacion(passwordConfirmacion) {
  const clave = typeof passwordConfirmacion === 'string' ? passwordConfirmacion.trim() : ''
  return clave ? { password_confirmacion: clave } : {}
}

/** Agrega un componente de solo presentación (título o separador, panel lateral de componentes)
 * — a diferencia del resto de acciones del editor, persiste de inmediato (no pasa por el
 * borrador ni por "Guardar cambios"), igual que `carteraService.agregarComponentePersonal`. */
export function agregarComponentePresentacional(dashboardId, { tipo, anchoColumnas, zona, passwordConfirmacion }) {
  return api.post(`/${dashboardId}/componentes-presentacionales`, {
    tipo, ancho_columnas: anchoColumnas, zona, ...cuerpoConfirmacion(passwordConfirmacion),
  }).then((r) => r.data)
}

/**
 * El archivo que alimenta el dashboard, con todas sus filas y columnas.
 *
 * Devuelve el blob y el nombre que propuso el backend (va en `Content-Disposition`): el nombre lo
 * arma el servidor porque incluye la fecha de corte de la carga, que acá no se conoce.
 */
export function descargarDatos(dashboardId) {
  return api.get(`/${dashboardId}/descargar-datos`, { responseType: 'blob' }).then((r) => ({
    blob: r.data,
    nombre: nombreDeLaDescarga(r.headers['content-disposition']) || `${dashboardId}.xlsx`,
  }))
}

/** El `filename` de un `Content-Disposition`, prefiriendo la forma `filename*` con acentos. */
function nombreDeLaDescarga(cabecera) {
  if (!cabecera) return ''
  const conAcentos = cabecera.match(/filename\*=UTF-8''([^;]+)/i)
  if (conAcentos) return decodeURIComponent(conAcentos[1])
  const simple = cabecera.match(/filename="([^"]+)"/i)
  return simple ? simple[1] : ''
}

export function obtenerVersiones(dashboardId) {
  return api.get(`/${dashboardId}/versions`).then((r) => r.data)
}

export function obtenerDashboardsAutorizados() {
  return api.get('/authorized').then((r) => r.data)
}

export function crearDashboard({ name, area, description, contexto }) {
  return api.post('/', { name, area, description, contexto }).then((r) => r.data)
}

export function actualizarDashboard(dashboardId, { name, area, contexto }) {
  return api.patch(`/${dashboardId}/`, { name, area, contexto }).then((r) => r.data)
}

export function eliminarDashboard(dashboardId, confirmationName) {
  return api.delete(`/${dashboardId}/`, { data: { confirmation_name: confirmationName } }).then((r) => r.data)
}

export function obtenerPestanas(dashboardId) {
  return api.get(`/${dashboardId}/pestanas`).then((r) => r.data)
}

export function crearPestana(dashboardId, { name }) {
  return api.post(`/${dashboardId}/pestanas`, { name }).then((r) => r.data)
}

/** Vista/procedimiento de la conexión externa "por defecto" configurada para ESTE dashboard/
 * pestaña puntual (`Dashboard.fuente_bd_tipo`/`fuente_bd_nombre`, ver
 * `backend/cartera/services/db_source.py`) — `{tipo: '', nombre: ''}` si no tiene ninguna. Separado
 * de `actualizarDashboard` (nombre/área/contexto) a propósito, ver docstring de
 * `DashboardFuenteBDView` en el backend. */
export function obtenerFuenteBD(dashboardId) {
  return api.get(`/${dashboardId}/fuente-bd`).then((r) => r.data)
}

export function actualizarFuenteBD(dashboardId, { tipo, nombre, parametros, fechaFormato, frecuenciaActualizacion }) {
  return api.put(`/${dashboardId}/fuente-bd`, {
    tipo, nombre, parametros, fecha_formato: fechaFormato, frecuencia_actualizacion: frecuenciaActualizacion,
  }).then((r) => r.data)
}

export function borrarDatosDashboard(dashboardId, confirmationName, passwordConfirmacion) {
  return api.post(`/${dashboardId}/borrar-datos`, {
    confirmation_name: confirmationName, ...cuerpoConfirmacion(passwordConfirmacion),
  }).then((r) => r.data)
}

export function obtenerAcceso(dashboardId) {
  return api.get(`/${dashboardId}/acceso`).then((r) => r.data)
}

export function actualizarAcceso(dashboardId, { rolesEditores, rolesLectores }) {
  return api.put(`/${dashboardId}/acceso`, { roles_editores: rolesEditores, roles_lectores: rolesLectores }).then((r) => r.data)
}

export function reasignarDueno(dashboardId, ownerId) {
  return api.patch(`/${dashboardId}/dueno`, { owner_id: ownerId }).then((r) => r.data)
}

// Timeout de las llamadas con IA: más largo que el resto porque incluyen una llamada a un LLM
// externo (Gemini) — el backend le da a esa llamada hasta 45s (`dashboard_interpretation.py`,
// `_TIMEOUT_SEGUNDOS`); acá se deja margen por encima de eso (60s), no el mismo valor, para que el
// backend siempre tenga chance de responder con su propio error de timeout antes de que el
// frontend aborte la request por su cuenta.
const _TIMEOUT_IA_MS = 60000

/** Interpretación completa del dashboard generada por IA (`services/dashboard_interpretation.py`). */
export function generarInterpretacion(dashboardId) {
  return api.post(`/${dashboardId}/interpretacion`, {}, { timeout: _TIMEOUT_IA_MS }).then((r) => r.data)
}

/** "Hallazgos clave" por componente generados por IA, un único llamado batch para todo el
 * dashboard (`{hallazgos: {component_id: texto}}`) — mismo timeout que `generarInterpretacion` por
 * la misma razón. Reemplaza progresivamente, componente por componente, el texto generado con
 * reglas fijas (`utils/hallazgosClave.js`), que sigue siendo el fallback instantáneo mientras esta
 * llamada resuelve o si falla (ver `HallazgosClaveCard.jsx`). */
export function generarHallazgosIA(dashboardId) {
  return api.post(`/${dashboardId}/hallazgos-ia`, {}, { timeout: _TIMEOUT_IA_MS }).then((r) => r.data)
}

/**
 * Consulta puntual de un deudor del dashboard: primero las coincidencias del texto, después el
 * detalle del cliente elegido.
 *
 * Son dos pasos y no uno solo porque un texto parcial puede tocar a varias razones sociales: el
 * usuario elige cuál antes de que se calcule nada, para no ver sumados dos clientes distintos.
 *
 * Las columnas del mapeo viajan como parámetros en vez de estar fijas en el backend: la sección es
 * reconfigurable como el resto del Directorio (otro archivo puede llamar distinto a la columna de
 * cliente o de saldo).
 */
export function buscarDeudores(dashboardId, { texto, columnas }) {
  return api.get(`/${dashboardId}/deudor`, {
    params: { buscar: texto, ...columnasAParams(columnas) },
  }).then((r) => r.data)
}

export function obtenerDetalleDeudor(dashboardId, { identidad, columnas, columnasDetalle }) {
  return api.get(`/${dashboardId}/deudor`, {
    params: {
      identidad,
      ...columnasAParams(columnas),
      // Se separan con `|` y no con coma: los nombres de columna del archivo traen comas
      // ("Vendedor / Ejecutivo Ventas" hoy, cualquier cosa mañana) y partirían mal del otro lado.
      columnas: (columnasDetalle || []).join('|'),
    },
  }).then((r) => r.data)
}

function columnasAParams(columnas) {
  return {
    columna_nombre: columnas?.nombre,
    columna_ruc: columnas?.ruc,
    columna_fecha: columnas?.fecha,
    columna_valor: columnas?.valor,
  }
}

/** Columnas del archivo vigente del dashboard — las ofrece el panel de configuración para elegir
 * cuáles muestra el detalle de la consulta por cliente. Mismo endpoint que la consulta: sin
 * `buscar` ni `identidad` devuelve solo la lista. */
export function obtenerColumnasDelArchivo(dashboardId) {
  return api.get(`/${dashboardId}/deudor`).then((r) => r.data)
}
