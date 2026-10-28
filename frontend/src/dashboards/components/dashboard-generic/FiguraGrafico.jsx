import { useId, useState } from 'react'
import { Button } from 'react-bootstrap'
import { formatNumber } from '../../utils/format'

/** Arma las columnas y filas de la tabla de datos de un gráfico de una sola serie
 * (`{categorias, valores}`). */
export function tablaDeUnaSerie(data, nombreValor = 'Valor') {
  return {
    columnas: ['Categoría', nombreValor],
    filas: (data?.categorias || []).map((categoria, i) => [categoria, data.valores?.[i] ?? null]),
  }
}

/** Arma las columnas y filas de la tabla de datos de un gráfico de varias series
 * (`{categorias, series: [{nombre, valores}]}`); `etiquetasPorSerie` respeta los títulos de
 * leyenda personalizados, igual que el gráfico. */
export function tablaDeVariasSeries(data, etiquetasPorSerie = {}) {
  const series = data?.series || []
  return {
    columnas: ['Categoría', ...series.map((serie) => etiquetasPorSerie[serie.nombre] || serie.nombre)],
    filas: (data?.categorias || []).map((categoria, i) => [categoria, ...series.map((serie) => serie.valores?.[i] ?? null)]),
  }
}

// Un valor que falta se muestra como «—» (sin dato), no como 0, que sería falso.
function formatearCelda(valor) {
  if (valor === null || valor === undefined || valor === '') return '—'
  return typeof valor === 'number' ? formatNumber(valor) : valor
}

/**
 * Contenedor común de los gráficos genéricos — auditoría UX/UI, fase 3, 28/10/2026. Antes cada
 * gráfico era un `div` con un SVG de Recharts y nada más: un lector de pantalla no sabía qué
 * representaba ni podía leer los valores. Ahora:
 * - el panel es un `<figure>` cuyo nombre es el título del componente (`<figcaption>`);
 * - los datos van siempre en una tabla. Oculta a la vista (`visually-hidden`, pero legible por
 *   lectores de pantalla) hasta que el usuario pulsa «Ver datos», que la muestra bajo el gráfico.
 * El botón lleva `d-print-none`: no aparece en la impresión ni en el PDF del dashboard.
 * Conserva la clase `chart-panel` porque la usan los estilos y `utils/pdfExport.js`.
 */
export default function FiguraGrafico({ titulo, descripcion, override, style, columnas, filas, pie, children }) {
  const [verDatos, setVerDatos] = useState(false)
  const idBase = useId()
  const idTitulo = `${idBase}-titulo`
  const idTabla = `${idBase}-tabla`
  const colorFondo = override?.colores?.colorFondo
  const colorTexto = override?.colores?.colorTexto
  const nombre = titulo || 'Gráfico'

  return (
    <figure
      className="chart-panel mb-0"
      aria-labelledby={idTitulo}
      style={{ ...style, ...(colorFondo ? { background: colorFondo } : undefined) }}
    >
      <figcaption>
        <div id={idTitulo} className="chart-panel__title" style={colorTexto ? { color: colorTexto } : undefined}>
          {nombre}
        </div>
        {descripcion && <div className="chart-panel__subtitle">{descripcion}</div>}
      </figcaption>
      {children}
      {filas?.length > 0 && (
        <>
          <div className="d-print-none">
            <Button
              variant="link"
              size="sm"
              className="px-0"
              // Con nombre propio: hay un «Ver datos» por gráfico. Sin
              // aria-expanded: la tabla está siempre al alcance del lector y
              // el botón solo la muestra en pantalla.
              aria-label={`${verDatos ? 'Ocultar' : 'Ver'} los datos de «${nombre}»`}
              onClick={() => setVerDatos((v) => !v)}
            >
              <i className={`bi ${verDatos ? 'bi-eye-slash' : 'bi-table'} me-1`} aria-hidden="true" />
              {verDatos ? 'Ocultar datos' : 'Ver datos'}
            </Button>
          </div>
          <div id={idTabla} className={verDatos ? 'table-responsive mb-2' : 'visually-hidden'}>
            <table className="table table-sm mb-0">
              <caption className={verDatos ? 'visually-hidden' : undefined}>Datos de «{nombre}»</caption>
              <thead>
                <tr>
                  {columnas.map((columna, i) => (
                    <th key={i} scope="col">{columna}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, i) => (
                  <tr key={i}>
                    {fila.map((celda, j) => (j === 0 ? (
                      <th key={j} scope="row">{formatearCelda(celda)}</th>
                    ) : (
                      <td key={j} className="text-end">{formatearCelda(celda)}</td>
                    )))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {pie}
    </figure>
  )
}
