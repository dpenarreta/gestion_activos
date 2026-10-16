import { useEffect, useState } from 'react'
import { Spinner } from 'react-bootstrap'
import * as historicoService from '../../services/historicoService'
import GenericDataTable from './GenericDataTable'

/**
 * Tabla 3 de la plantilla fija: a diferencia del resto de posiciones (una foto fija,
 * calculada una sola vez al aplicar el mapeo de un archivo), esta consulta en vivo la tabla
 * histórica comparativa entre las cargas HABILITADAS del dashboard (una fila por carga con
 * `incluir_en_historico=True`, las mismas columnas de valor que se mapearon para esta posición)
 * cada vez que se ve el dashboard — así reflejan archivos subidos después de la última vez que se
 * aplicó el mapeo, sin tener que volver a aplicarlo. Qué cargas cuentan se decide desde "Histórico
 * de cargas" (checkbox "Incluir" por carga, `DashboardHistoricoPage.jsx`), no acá: este componente
 * nunca manda `cargaIds` a `calcularTablaHistorica`, así que siempre usa el filtro por defecto del
 * backend (`historico.calcular_tabla_historica`). Reutiliza los mismos endpoints que "Ver
 * histórico" (`historicoService`) y el mismo `GenericDataTable` para dibujar el resultado (orden,
 * paginación y hallazgos clave incluidos). Todo lo que este componente renderiza directamente ES
 * la comparación histórica, así que siempre lleva la etiqueta fija "Histórica" (`esHistorica`, ver
 * `GenericDataTable`).
 *
 * Si todavía no hay ninguna carga histórica habilitada para el dashboard, o esta posición nunca se
 * mapeó a ninguna columna de valor (dashboard nuevo, con dato ficticio), cae a `contenidoNormal` —
 * no hay nada que comparar todavía. Ojo con la diferencia entre "no hay cargas históricas" (esta
 * carga nunca se aplicó a la plantilla) y "hay cargas históricas pero ninguna habilitada" (el
 * usuario las deshabilitó todas desde "Histórico de cargas"): `listarCargasHistoricas` sigue
 * devolviendo esas cargas deshabilitadas (las necesita esa pantalla para poder rehabilitarlas), así
 * que `calcularTablaHistorica` igual se llama y puede devolver `filas: []` — se trata igual que
 * "nada que comparar" (cae a `contenidoNormal`), no como una tabla histórica vacía.
 */
export default function TablaHistoricaAutomatica({ dashboardId, columnasValor, override, contenidoNormal }) {
  const columnasValidas = (columnasValor || []).filter((c) => c?.columna)
  const claveColumnas = JSON.stringify(columnasValidas)

  const [tabla, setTabla] = useState(null)
  const [cargando, setCargando] = useState(columnasValidas.length > 0)

  useEffect(() => {
    if (columnasValidas.length === 0) {
      setTabla(null)
      setCargando(false)
      return undefined
    }

    let cancelado = false
    setCargando(true)
    historicoService.listarCargasHistoricas(dashboardId)
      .then((resultado) => (
        resultado.cargas.length > 0
          ? historicoService.calcularTablaHistorica(dashboardId, columnasValidas)
          : null
      ))
      .then((resultado) => { if (!cancelado) setTabla(resultado) })
      .catch(() => { if (!cancelado) setTabla(null) })
      .finally(() => { if (!cancelado) setCargando(false) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las columnas se comparan por su versión serializada (claveColumnas)
  }, [dashboardId, claveColumnas])

  if (cargando) {
    return (
      <div className="chart-panel text-center py-4">
        <Spinner animation="border" size="sm" role="status" />
      </div>
    )
  }

  if (tabla && tabla.filas?.length > 0) {
    return (
      <GenericDataTable
        data={{ titulo: override?.titulo, descripcion: override?.descripcion, columnas: tabla.columnas, filas: tabla.filas }}
        override={override}
        esHistorica
      />
    )
  }

  return contenidoNormal
}
