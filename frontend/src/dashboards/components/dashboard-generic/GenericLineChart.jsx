import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/format'
import HallazgosClaveCard from './HallazgosClaveCard'
import FiguraGrafico, { tablaDeUnaSerie } from './FiguraGrafico'

function acortar(texto, max = 22) {
  if (!texto) return ''
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}

/**
 * Renderiza un componente type=chart de una sola serie (`{titulo, categorias, valores}`) como
 * línea — útil sobre todo cuando las categorías tienen un orden natural (fechas, meses).
 */
export default function GenericLineChart({ data, override, hallazgoIA }) {
  if (!data) return null
  const datosGrafico = (data.categorias || []).map((categoria, i) => ({
    categoria, etiqueta: acortar(categoria), valor: data.valores?.[i] ?? 0,
  }))
  const colorPrincipal = override?.colores?.colorPrincipal || 'var(--series-1)'

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
        <LineChart accessibilityLayer data={datosGrafico} margin={{ left: 12, right: 24, top: 8, bottom: 32 }}>
          <CartesianGrid stroke="var(--gridline)" />
          <XAxis dataKey="etiqueta" angle={-30} textAnchor="end" interval={0} height={50} />
          <YAxis width={96} tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(value) => formatNumber(value)} labelFormatter={(_, payload) => payload?.[0]?.payload?.categoria} />
          <Line type="monotone" dataKey="valor" stroke={colorPrincipal} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </FiguraGrafico>
  )
}
