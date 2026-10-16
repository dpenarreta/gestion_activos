import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/format'
import { propsLeyendaPara } from '../../utils/legendPosition'
import { PALETA_CATEGORICA } from '../../utils/colors'
import HallazgosClaveCard from './HallazgosClaveCard'

function acortar(texto, max = 22) {
  if (!texto) return ''
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}

/**
 * Renderiza un componente type=chart de varias series (`{titulo, categorias, series: [{nombre,
 * valores}]}`, ver `services/generic_charts.py::generar_datos_multiserie`) como barras agrupadas
 * (una barra por serie, lado a lado) o apiladas (`apilado=true`, todas las series en una sola
 * barra por categoría). Cada serie tiene su propio color, editable individualmente
 * (`override.colores.coloresPorSerie`), y su propio título de leyenda, editable individualmente
 * (`override.colores.etiquetasPorSerie` — `dataKey` sigue siendo el nombre real de la serie, solo
 * cambia el texto que muestran la leyenda y el tooltip vía el prop `name`).
 */
export default function GenericMultiSeriesBarChart({ data, override, apilado = false, leyendaPosicion, hallazgoIA }) {
  if (!data?.series?.length) return null

  const coloresPorSerie = override?.colores?.coloresPorSerie || {}
  const etiquetasPorSerie = override?.colores?.etiquetasPorSerie || {}
  const datosGrafico = (data.categorias || []).map((categoria, i) => {
    const fila = { categoria, etiqueta: acortar(categoria) }
    for (const serie of data.series) fila[serie.nombre] = serie.valores?.[i] ?? 0
    return fila
  })

  return (
    <div className="chart-panel" style={override?.colores?.colorFondo ? { background: override.colores.colorFondo } : undefined}>
      <div className="chart-panel__title" style={override?.colores?.colorTexto ? { color: override.colores.colorTexto } : undefined}>
        {override?.titulo || data.titulo}
      </div>
      {(override?.descripcion || data.descripcion) && (
        <div className="chart-panel__subtitle">{override?.descripcion || data.descripcion}</div>
      )}
      <ResponsiveContainer width="100%" height={370}>
        <BarChart data={datosGrafico} margin={{ left: 12, right: 24, top: 8, bottom: 40 }}>
          <CartesianGrid stroke="var(--gridline)" />
          <XAxis dataKey="etiqueta" angle={-30} textAnchor="end" interval={0} height={70} />
          <YAxis width={96} tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(value) => formatNumber(value)} />
          <Legend {...propsLeyendaPara(leyendaPosicion)} />
          {data.series.map((serie, i) => (
            <Bar
              key={serie.nombre}
              dataKey={serie.nombre}
              name={etiquetasPorSerie[serie.nombre] || serie.nombre}
              stackId={apilado ? 'a' : undefined}
              fill={coloresPorSerie[serie.nombre] || PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]}
              radius={apilado ? undefined : [4, 4, 0, 0]}
              maxBarSize={40}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <HallazgosClaveCard variante="multiserie" datosMultiserie={data} textoIA={hallazgoIA} />
    </div>
  )
}
