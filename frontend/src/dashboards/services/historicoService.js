import api from './api'

export function listarCargasHistoricas(dashboardId) {
  return api.get('/historico/cargas', { params: { dashboard_id: dashboardId } }).then((r) => r.data)
}

export function calcularTablaHistorica(dashboardId, columnasValor, cargaIds) {
  return api.post('/historico/tabla', {
    dashboard_id: dashboardId,
    columnas_valor: columnasValor,
    carga_ids: cargaIds || undefined,
  }).then((r) => r.data)
}

export function obtenerArchivoCarga(cargaId) {
  return api.get(`/historico/cargas/${cargaId}/archivo`).then((r) => r.data)
}

/** Habilita/deshabilita una carga puntual para la comparación histórica del dashboard — persiste
 * de inmediato (checkbox en `DashboardHistoricoPage`). Afecta tanto la vista previa de esa página
 * como Tabla 3 dentro del dashboard real, ya que ambas llaman a `calcularTablaHistorica` sin
 * `cargaIds`. */
export function establecerCargaIncluida(cargaId, incluir) {
  return api.patch(`/historico/cargas/${cargaId}/incluir`, { incluir }).then((r) => r.data)
}
