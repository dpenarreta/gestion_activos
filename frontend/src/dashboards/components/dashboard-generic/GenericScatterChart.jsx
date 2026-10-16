import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../utils/format'
import HallazgosClaveCard from './HallazgosClaveCard'

/**
 * Renderiza un componente type=chart de dispersión (`{titulo, puntos: [{x, y}]}`, ver
 * `services/generic_charts.py::generar_datos_dispersion`) — a diferencia del resto de gráficas
 * genéricas, no agrupa por categoría: cada punto es una fila del archivo con sus dos valores
 * numéricos (x, y). Un único color para todos los puntos (`override.colores.colorPrincipal`), ya
 * que no hay categorías que distinguir por color.
 */
export default function GenericScatterChart({ data, override, hallazgoIA }) {
  if (!data?.puntos?.length) return null
  const colorPrincipal = override?.colores?.colorPrincipal || 'var(--series-1)'

  return (
    <div className="chart-panel" style={override?.colores?.colorFondo ? { background: override.colores.colorFondo } : undefined}>
      <div className="chart-panel__title" style={override?.colores?.colorTexto ? { color: override.colores.colorTexto } : undefined}>
        {override?.titulo || data.titulo}
      </div>
      {(override?.descripcion || data.descripcion) && (
        <div className="chart-panel__subtitle">{override?.descripcion || data.descripcion}</div>
      )}
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ left: 12, right: 24, top: 8, bottom: 8 }}>
          <CartesianGrid stroke="var(--gridline)" />
          <XAxis type="number" dataKey="x" name="X" tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
          <YAxis type="number" dataKey="y" name="Y" width={96} tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(value) => formatNumber(value)} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data.puntos} fill={colorPrincipal} />
        </ScatterChart>
      </ResponsiveContainer>
      <HallazgosClaveCard variante="dispersion" datos={data} textoIA={hallazgoIA} />
    </div>
  )
}
