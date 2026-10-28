import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatNumber } from '../../utils/format'
import { propsLeyendaPara } from '../../utils/legendPosition'
import { PALETA_CATEGORICA } from '../../utils/colors'
import HallazgosClaveCard from './HallazgosClaveCard'
import FiguraGrafico from './FiguraGrafico'
import { datosCircularConEtiquetas } from './pieChartData'

/**
 * Renderiza un componente type=chart de una sola serie (`{titulo, categorias, valores}`) como
 * pastel o dona (`dona=true`, con un agujero central) — cada categoría es una porción, con su
 * propio color editable individualmente (`override.colores.coloresPorCategoria`) y su propio
 * título de leyenda editable individualmente (`override.colores.etiquetasPorCategoria`) — el dato
 * real (la categoría original) sigue usándose para buscar el color y como identidad de la porción
 * (`datosCircularConEtiquetas`), así renombrar la leyenda nunca rompe esa relación ni el resto del
 * gráfico (ejes, hallazgos clave), que siguen mostrando el nombre real de la categoría.
 * `mostrarTotal` (solo tiene efecto junto con `dona`) dibuja la suma de todos los valores
 * centrada dentro del agujero.
 */
export default function GenericPieChart({ data, override, dona = false, leyendaPosicion, mostrarTotal = false, hallazgoIA }) {
  if (!data) return null
  const coloresPorCategoria = override?.colores?.coloresPorCategoria || {}
  const datosGrafico = datosCircularConEtiquetas(data, override?.colores?.etiquetasPorCategoria)
  const total = (data.valores || []).reduce((suma, v) => suma + (v || 0), 0)

  // Auditoría UX/UI, fase 3, 28/10/2026: los mismos datos, en tabla, para quien no ve el gráfico.
  // Con los títulos de leyenda personalizados, igual que las porciones.
  const tablaDatos = { columnas: ['Categoría', 'Valor'], filas: datosGrafico.map((porcion) => [porcion.nombre, porcion.valor]) }

  return (
    <FiguraGrafico
      titulo={override?.titulo || data.titulo}
      descripcion={override?.descripcion || data.descripcion}
      override={override}
      style={{ position: 'relative' }}
      {...tablaDatos}
      pie={<HallazgosClaveCard variante="categorico" datos={data} textoIA={hallazgoIA} />}
    >
      <ResponsiveContainer width="100%" height={340}>
        <PieChart accessibilityLayer>
          <Pie
            data={datosGrafico}
            dataKey="valor"
            nameKey="nombre"
            innerRadius={dona ? '55%' : 0}
            outerRadius="80%"
            paddingAngle={dona ? 2 : 0}
          >
            {datosGrafico.map((entrada, i) => (
              <Cell key={entrada.id} fill={coloresPorCategoria[entrada.id] || PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => formatNumber(value)} />
          <Legend {...propsLeyendaPara(leyendaPosicion)} />
        </PieChart>
      </ResponsiveContainer>
      {dona && mostrarTotal && (
        <div
          className="pie-chart__total text-center grafico-dona__centro"
        >
          <div className="grafico-dona__etiqueta">Total</div>
          <div className="grafico-dona__valor">{formatNumber(total)}</div>
        </div>
      )}
    </FiguraGrafico>
  )
}
