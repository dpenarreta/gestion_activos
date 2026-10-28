import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/format'
import { propsLeyendaPara } from '../../utils/legendPosition'
import { PALETA_CATEGORICA } from '../../utils/colors'
import HallazgosClaveCard from './HallazgosClaveCard'
import FiguraGrafico, { tablaDeVariasSeries } from './FiguraGrafico'

function acortar(texto, max = 22) {
  if (!texto) return ''
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}

/**
 * Renderiza un componente type=chart de varias series (`{titulo, categorias, series: [{nombre,
 * valores}]}`, mismo dato que las barras agrupadas/apiladas — ver
 * `services/generic_charts.py::generar_datos_multiserie`) como un área apilada: cada serie es una
 * capa de color sobre la anterior, siempre apiladas (a diferencia de las barras, un área agrupada
 * sin apilar no se distingue visualmente). Cada serie tiene su propio color, editable
 * individualmente (`override.colores.coloresPorSerie`), y su propio título de leyenda, editable
 * individualmente (`override.colores.etiquetasPorSerie` — `dataKey` sigue siendo el nombre real de
 * la serie, solo cambia el texto que muestran la leyenda y el tooltip vía el prop `name`).
 */
export default function GenericStackedAreaChart({ data, override, leyendaPosicion, hallazgoIA }) {
  if (!data?.series?.length) return null

  const coloresPorSerie = override?.colores?.coloresPorSerie || {}
  const etiquetasPorSerie = override?.colores?.etiquetasPorSerie || {}
  const datosGrafico = (data.categorias || []).map((categoria, i) => {
    const fila = { categoria, etiqueta: acortar(categoria) }
    for (const serie of data.series) fila[serie.nombre] = serie.valores?.[i] ?? 0
    return fila
  })

  // Auditoría UX/UI, fase 3, 28/10/2026: los mismos datos, en tabla, para quien no ve el gráfico.
  const tablaDatos = tablaDeVariasSeries(data, etiquetasPorSerie)

  return (
    <FiguraGrafico
      titulo={override?.titulo || data.titulo}
      descripcion={override?.descripcion || data.descripcion}
      override={override}
      {...tablaDatos}
      pie={<HallazgosClaveCard variante="multiserie" datosMultiserie={data} textoIA={hallazgoIA} />}
    >
      <ResponsiveContainer width="100%" height={370}>
        <AreaChart accessibilityLayer data={datosGrafico} margin={{ left: 12, right: 24, top: 8, bottom: 40 }}>
          <CartesianGrid stroke="var(--gridline)" />
          <XAxis dataKey="etiqueta" angle={-30} textAnchor="end" interval={0} height={70} />
          <YAxis width={96} tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(value) => formatNumber(value)} />
          <Legend {...propsLeyendaPara(leyendaPosicion)} />
          {data.series.map((serie, i) => {
            const color = coloresPorSerie[serie.nombre] || PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]
            return (
              <Area
                key={serie.nombre}
                type="monotone"
                dataKey={serie.nombre}
                name={etiquetasPorSerie[serie.nombre] || serie.nombre}
                stackId="a"
                stroke={color}
                fill={color}
                fillOpacity={0.6}
              />
            )
          })}
        </AreaChart>
      </ResponsiveContainer>
    </FiguraGrafico>
  )
}
