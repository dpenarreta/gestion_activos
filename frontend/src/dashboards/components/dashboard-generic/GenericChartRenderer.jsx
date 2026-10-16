import GenericKpiCard from './GenericKpiCard'
import GenericBarChart from './GenericBarChart'
import GenericMultiSeriesBarChart from './GenericMultiSeriesBarChart'
import GenericStackedAreaChart from './GenericStackedAreaChart'
import GenericMultiLineChart from './GenericMultiLineChart'
import GenericLineChart from './GenericLineChart'
import GenericPieChart from './GenericPieChart'
import GenericDataTable from './GenericDataTable'
import GenericScatterChart from './GenericScatterChart'

/** Une varias series (`{categorias, series:[{nombre,valores}]}`, 2+ columnas de valor) en una
 * sola porción por categoría (`{categorias, valores}`, sumando las series de esa categoría) —
 * necesario porque un gráfico circular (pastel/dona) solo puede mostrar una cantidad por
 * categoría, nunca varias series a la vez, a diferencia de barras/líneas/área. */
function categoricoDesdeMultiserie(datosMultiserie) {
  if (!datosMultiserie?.categorias?.length || !datosMultiserie.series?.length) return null
  const valores = datosMultiserie.categorias.map((_, i) => (
    datosMultiserie.series.reduce((suma, serie) => suma + (serie.valores?.[i] || 0), 0)
  ))
  return { categorias: datosMultiserie.categorias, valores }
}

/**
 * Único punto que decide qué componente de presentación usar según `tipoVisualizacion` (uno de
 * `TIPOS_VISUALIZACION`, ver `utils/chartTypes.js`) — usado tanto para la vista previa de una
 * recomendación (datos ya calculados, sin persistir todavía) como para renderizar un componente
 * ya agregado al dashboard (`component.chart_type`). Así "los gráficos sugeridos se pueden
 * visualizar de cualquiera de estas formas" sin duplicar la lógica de despacho en dos lugares.
 */
// Los 4 tipos "de una sola columna" (mínimo que siempre debe estar disponible, ver
// `utils/plantillaSlots.js::TIPOS_COMPATIBLES`) son compatibles con posiciones de 2+ columnas de
// valor (`multivalor`/`multiserie`) aunque su contenido calculado siga llegando como
// `datosMultiserie` (varias series) — se colapsan en una sola porción/barra por categoría en vez
// de pedirle al usuario que rehaga el mapeo a una columna.
const TIPOS_DE_UNA_SOLA_COLUMNA = new Set(['pastel', 'dona', 'barras_verticales', 'barras_horizontales'])

export default function GenericChartRenderer({ tipoVisualizacion, datos, datosMultiserie, titulo, override, config, esHistorica, hallazgoIA }) {
  const esDeUnaSolaColumna = TIPOS_DE_UNA_SOLA_COLUMNA.has(tipoVisualizacion)
  const datosColapsados = esDeUnaSolaColumna ? (datos || categoricoDesdeMultiserie(datosMultiserie)) : datos
  const datosConTitulo = datosColapsados ? { ...datosColapsados, titulo } : null
  const datosMultiserieConTitulo = datosMultiserie ? { ...datosMultiserie, titulo } : null
  const leyendaPosicion = config?.leyenda_posicion

  switch (tipoVisualizacion) {
    case 'kpi':
      return datosConTitulo ? <GenericKpiCard data={datosConTitulo} override={override} config={config} hallazgoIA={hallazgoIA} /> : null
    case 'barras_verticales':
      return <GenericBarChart data={datosConTitulo} override={override} orientacion="vertical" hallazgoIA={hallazgoIA} />
    case 'barras_agrupadas':
      return <GenericMultiSeriesBarChart data={datosMultiserieConTitulo} override={override} apilado={false} leyendaPosicion={leyendaPosicion} hallazgoIA={hallazgoIA} />
    case 'barras_apiladas':
      return <GenericMultiSeriesBarChart data={datosMultiserieConTitulo} override={override} apilado leyendaPosicion={leyendaPosicion} hallazgoIA={hallazgoIA} />
    case 'area_apilada':
      return <GenericStackedAreaChart data={datosMultiserieConTitulo} override={override} leyendaPosicion={leyendaPosicion} hallazgoIA={hallazgoIA} />
    case 'lineas_multiples':
      return <GenericMultiLineChart data={datosMultiserieConTitulo} override={override} leyendaPosicion={leyendaPosicion} hallazgoIA={hallazgoIA} />
    case 'lineas':
      return <GenericLineChart data={datosConTitulo} override={override} hallazgoIA={hallazgoIA} />
    case 'pastel':
      return <GenericPieChart data={datosConTitulo} override={override} leyendaPosicion={leyendaPosicion} hallazgoIA={hallazgoIA} />
    case 'dona':
      return <GenericPieChart data={datosConTitulo} override={override} dona leyendaPosicion={leyendaPosicion} mostrarTotal={Boolean(config?.mostrar_total)} hallazgoIA={hallazgoIA} />
    case 'tabla':
      return <GenericDataTable data={datosConTitulo} override={override} esHistorica={esHistorica} hallazgoIA={hallazgoIA} />
    case 'dispersion':
      return <GenericScatterChart data={datosConTitulo} override={override} hallazgoIA={hallazgoIA} />
    case 'barras_horizontales':
    default:
      return <GenericBarChart data={datosConTitulo} override={override} orientacion="horizontal" hallazgoIA={hallazgoIA} />
  }
}
