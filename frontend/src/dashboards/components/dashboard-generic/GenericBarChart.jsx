import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/format'
import { PALETA_CATEGORICA } from '../../utils/colors'
import HallazgosClaveCard from './HallazgosClaveCard'
import FiguraGrafico, { tablaDeUnaSerie } from './FiguraGrafico'

function acortar(texto, max = 22) {
  if (!texto) return ''
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}

/**
 * Renderiza un componente type=chart de una sola serie (`{titulo, categorias, valores}`) como
 * barras — `orientacion` decide si las barras se dibujan acostadas ("horizontales", una fila por
 * categoría — el diseño original de esta app) o de pie ("verticales", una columna por categoría).
 * Cada categoría (cada barra) tiene su propio color, editable individualmente
 * (`override.colores.coloresPorCategoria`) — no un único color compartido por todas las barras.
 */
export default function GenericBarChart({ data, override, orientacion = 'horizontal', hallazgoIA }) {
  if (!data) return null
  const datosGrafico = (data.categorias || []).map((categoria, i) => ({
    categoria, etiqueta: acortar(categoria), valor: data.valores?.[i] ?? 0,
  }))
  const coloresPorCategoria = override?.colores?.coloresPorCategoria || {}
  const colorDe = (categoria, i) => coloresPorCategoria[categoria] || PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]
  const esHorizontal = orientacion === 'horizontal'

  // Auditoría UX/UI, fase 3, 28/10/2026: los mismos datos, en tabla, para quien no ve el gráfico.
  const tablaDatos = tablaDeUnaSerie(data)

  return (
    <FiguraGrafico
      titulo={override?.titulo || data.titulo}
      descripcion={override?.descripcion || data.descripcion}
      override={override}
      {...tablaDatos}
      pie={<HallazgosClaveCard variante="categorico" datos={data} textoIA={hallazgoIA} />}
    >
      <ResponsiveContainer width="100%" height={320}>
        <BarChart accessibilityLayer
          data={datosGrafico}
          layout={esHorizontal ? 'vertical' : 'horizontal'}
          margin={esHorizontal ? { left: 12, right: 24, top: 8 } : { left: 12, right: 24, top: 8, bottom: 32 }}
        >
          <CartesianGrid horizontal={!esHorizontal} stroke="var(--gridline)" />
          {esHorizontal ? (
            <>
              <XAxis type="number" tickFormatter={(v) => formatNumber(v)} />
              <YAxis type="category" dataKey="etiqueta" width={160} />
            </>
          ) : (
            <>
              <XAxis type="category" dataKey="etiqueta" angle={-30} textAnchor="end" interval={0} height={50} />
              <YAxis type="number" width={96} tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
            </>
          )}
          <Tooltip formatter={(value) => formatNumber(value)} labelFormatter={(_, payload) => payload?.[0]?.payload?.categoria} />
          <Bar
            dataKey="valor"
            radius={esHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={esHorizontal ? 22 : 40}
          >
            {datosGrafico.map((fila, i) => (
              <Cell key={fila.categoria} fill={colorDe(fila.categoria, i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </FiguraGrafico>
  )
}
