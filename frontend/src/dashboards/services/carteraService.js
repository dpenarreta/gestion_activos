import api from './api'

export function validarArchivo(archivo, hoja, dashboardId) {
  const formData = new FormData()
  formData.append('archivo', archivo)
  if (hoja) formData.append('hoja', hoja)
  if (dashboardId) formData.append('dashboard_id', dashboardId)
  return api.post('/validar-archivo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data)
}

/** "Conectar vista de base de datos": ejecuta la vista/procedimiento ya configurado para este
 * dashboard (`dashboardLayoutService.actualizarFuenteBD`) contra la conexión externa "por
 * defecto" y arma una carga lista para el asistente — misma forma de respuesta que
 * `validarArchivo`, para que `useGenericDashboardBuilder` pueda tratarla exactamente igual. */
export function conectarFuenteBD(dashboardId) {
  return api.post('/conectar-fuente-bd', { dashboard_id: dashboardId }).then((r) => r.data)
}

/** Ícono "Actualizar ahora" (solo dashboards con fuente configurada y sin frecuencia automática,
 * ver `DashboardAreaPage.jsx`) — corre la MISMA actualización sin asistente que la programada
 * (reaplica el último mapeo/aliases confirmados), en vez de pasar por `conectarFuenteBD` + todo el
 * asistente de columnas. Nunca rechaza por un mapeo faltante: revisa `data.ok` en la respuesta.
 * `fechaCorte` (AAAA-MM-DD, opcional) reemplaza el parámetro de fecha del procedimiento: sin
 * frecuencia no hay período que avanzar, y sin ella volvía a traer los mismos datos. */
export function actualizarFuenteBDAhora(dashboardId, fechaCorte) {
  const cuerpo = { dashboard_id: dashboardId }
  if (fechaCorte) cuerpo.fecha_corte = fechaCorte
  return api.post('/actualizar-fuente-bd-ahora', cuerpo).then((r) => r.data)
}

export function sugerirMapeoPlantilla(cargaId, aliases, valoresBlancos) {
  return api.post('/plantilla/sugerir', { carga_id: cargaId, aliases, valores_blancos: valoresBlancos }).then((r) => r.data)
}

export function previsualizarMapeoPlantilla(cargaId, mapeo, aliases, valoresBlancos) {
  return api.post('/plantilla/previsualizar', { carga_id: cargaId, mapeo, aliases, valores_blancos: valoresBlancos }).then((r) => r.data)
}

export function previsualizarMapeoComponente(cargaId, { calculo, titulo, mapeo }) {
  return api.post('/plantilla/previsualizar-componente', { carga_id: cargaId, calculo, titulo, mapeo }).then((r) => r.data)
}

export function aplicarMapeoPlantilla(cargaId, mapeo, aliases, valoresBlancos, columnasHistoricas) {
  return api.post('/plantilla/aplicar', {
    carga_id: cargaId, mapeo, aliases, valores_blancos: valoresBlancos, columnas_historicas: columnasHistoricas,
  }).then((r) => r.data)
}

export function obtenerValoresColumnaPlantilla(cargaId, columna, aliases, valoresBlancos) {
  return api.post('/plantilla/valores-columna', { carga_id: cargaId, columna, aliases, valores_blancos: valoresBlancos }).then((r) => r.data)
}

export function obtenerDuplicadosColumna(cargaId, columna, aliases, valoresBlancos) {
  return api.post('/plantilla/duplicados-columna', { carga_id: cargaId, columna, aliases, valores_blancos: valoresBlancos }).then((r) => r.data)
}

export function obtenerArchivoActualDashboard(dashboardId) {
  return api.post('/plantilla/archivo-actual', { dashboard_id: dashboardId }).then((r) => r.data)
}

/** Agrega UN componente nuevo a la "Zona Personal" del dashboard — reutiliza el endpoint legado
 * `POST /agregar-grafica` (`services/dashboard_layout.py::agregar_componente_generado`), fijando
 * siempre `zona: 'personal'` para que quede marcado y agrupado aparte (`config.zona`, ver
 * `EditableGrid.jsx`). A diferencia del resto del editor de dashboard, esto persiste de inmediato
 * (no pasa por el borrador ni "Guardar cambios") — el llamador debe refrescar el layout después
 * (`useDashboardLayout().recargar()`). */
/** `passwordConfirmacion` solo viaja si el dashboard tiene el diseño bloqueado y la persona ya
 * confirmó su contraseña para autorizar este alta (ver `services/desbloqueo.py`). */
export function agregarComponentePersonal(payload, passwordConfirmacion) {
  return api.post('/agregar-grafica', {
    ...payload, zona: 'personal',
    ...(passwordConfirmacion ? { password_confirmacion: passwordConfirmacion } : {}),
  }).then((r) => r.data)
}

export function procesarArchivo({ cargaId, mapeo, fechaCorte, hoja }) {
  return api.post('/procesar', {
    carga_id: cargaId,
    mapeo,
    fecha_corte: fechaCorte || undefined,
    hoja: hoja || undefined,
  }).then((r) => r.data)
}

export function obtenerResumen(cargaId, params) {
  return api.get(`/resumen/${cargaId}`, { params }).then((r) => r.data)
}

export function obtenerTopClientes(cargaId, params) {
  return api.get(`/top-clientes/${cargaId}`, { params }).then((r) => r.data)
}

export function obtenerParetoCiudades(cargaId, params) {
  return api.get(`/pareto-ciudades/${cargaId}`, { params }).then((r) => r.data)
}

export function obtenerRecuperadores(cargaId, params) {
  return api.get(`/recuperadores/${cargaId}`, { params }).then((r) => r.data)
}

export function obtenerCausales(cargaId, params) {
  return api.get(`/causales/${cargaId}`, { params }).then((r) => r.data)
}

export function obtenerRecuperadoresCausales(cargaId, params) {
  return api.get(`/recuperadores-causales/${cargaId}`, { params }).then((r) => r.data)
}

export function obtenerDetalle(cargaId, params) {
  return api.get(`/detalle/${cargaId}`, { params }).then((r) => r.data)
}

export function urlExportar(cargaId, params) {
  const query = new URLSearchParams(params).toString()
  return `/api/cartera/exportar/${cargaId}${query ? `?${query}` : ''}`
}

export function eliminarArchivo(cargaId) {
  return api.delete(`/archivo/${cargaId}`)
}
