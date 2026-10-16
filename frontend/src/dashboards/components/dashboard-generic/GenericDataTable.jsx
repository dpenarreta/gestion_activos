import { useId, useMemo, useState } from 'react'
import { Badge, Table } from 'react-bootstrap'
import { formatNumber } from '../../utils/format'
import { usePaginacionCliente } from '../../hooks/usePaginacionCliente'
import { PAGE_SIZES_PERMITIDOS } from '../../config/pageSizes'
import Pagination from '../common/Pagination'
import HallazgosClaveCard from './HallazgosClaveCard'

// El tamaño por defecto SÍ es propio de esta tabla (5, no el 10 general): son las tablas de la
// plantilla del dashboard, que conviven con gráficos en la misma pantalla y no deben ocuparla
// entera. Las opciones ofrecidas, en cambio, salen del conjunto único (`config/pageSizes.js`) —
// esta tabla ofrecía un 20 que no está permitido y no ofrecía el 100.
const TAMANO_PAGINA_DEFECTO = 5

function celda(valor) {
  return typeof valor === 'number' ? formatNumber(valor) : valor
}

/** Celda de la columna "Resultado" (tabla `cumplimiento_metas`, ver
 * `services/generic_charts.py::etiqueta_cumplimiento`) — único resaltado condicional de
 * `GenericDataTable` hoy: el resto de columnas siempre se muestra como texto plano
 * (`celda(valor)`), sin colores ni badges basados en el valor. */
function BadgeResultado({ valor }) {
  if (valor === 'Cumple') return <Badge bg="success">{valor}</Badge>
  if (valor === 'Sin meta') return <Badge bg="secondary">{valor}</Badge>
  return <Badge bg="danger">{valor}</Badge>
}

function comparar(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true })
}

/** Encabezado de columna clickeable para ordenar (mismo criterio que `DetalleTable.jsx`: primer
 * clic ordena ascendente, un segundo clic sobre la misma columna invierte a descendente, y elegir
 * otra columna vuelve a empezar en ascendente — sin un tercer estado "sin orden"). */
function EncabezadoOrdenable({ columna, alineadoDerecha, ordenActivo, onClick, children }) {
  const activo = ordenActivo?.columna === columna
  return (
    <th
      className={alineadoDerecha ? 'text-end' : undefined}
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-label={`Ordenar por ${children}`}
    >
      {children}
      {activo ? (ordenActivo.direccion === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

function useOrdenTabla() {
  const [orden, setOrden] = useState(null) // { columna, direccion: 'asc' | 'desc' } | null
  const alternar = (columna) => {
    setOrden((prev) => (prev?.columna === columna
      ? { columna, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' }
      : { columna, direccion: 'asc' }))
  }
  return [orden, alternar]
}

/** Pagina en memoria filas ya ordenadas (sección 24: por defecto 5, elegibles 5/10/20/25/50) —
 * si las filas totales ya caben en la página 1 con el tamaño por defecto (`TAMANO_PAGINA_DEFECTO`
 * filas o menos), no hay nada que paginar todavía, así que ni el selector de "filas por página"
 * ni el paginador (siguiente/anterior) se muestran — la tabla se ve tal cual es, sin ese control
 * de más. Reordenar (`ordenKey` distinto) vuelve siempre a la página 1, para no dejar a alguien
 * viendo una página que ya no corresponde al nuevo orden. */
function useTablaPaginada(filasOrdenadas, ordenKey) {
  const paginacion = usePaginacionCliente(filasOrdenadas, { defaultPageSize: TAMANO_PAGINA_DEFECTO, resetKey: ordenKey })
  const mostrarPaginador = filasOrdenadas.length > TAMANO_PAGINA_DEFECTO
  return { filasPagina: mostrarPaginador ? paginacion.itemsPagina : filasOrdenadas, mostrarPaginador, paginacion }
}

function BarraPaginacion({ idBase, paginacion }) {
  return (
    <Pagination
      idBase={idBase}
      paginaActual={paginacion.pagina}
      totalPaginas={paginacion.totalPaginas}
      totalRegistros={paginacion.totalRegistros}
      pageSize={paginacion.pageSize}
      allowedPageSizes={PAGE_SIZES_PERMITIDOS}
      onCambiarPagina={paginacion.irAPagina}
      onCambiarPageSize={paginacion.cambiarPageSize}
    />
  )
}

/** Tabla de N columnas (`{columnas: [...], filas: [[...]], total: [...]}`, ver
 * `services/generic_charts.py::generar_datos_tabla`) — la primera columna es la identidad de la
 * fila (queda a la izquierda), el resto son valores (a la derecha), y la fila de totales va en
 * negrita (siempre fija, fuera de la paginación: es un resumen de la tabla completa, no de la
 * página actual). Usada por la plantilla fija de dashboard (Tabla 1/2/3), donde cada posición
 * puede traer una cantidad distinta de columnas según qué archivo se haya cargado. Cualquier
 * columna se puede ordenar de mayor a menor o viceversa haciendo clic en su encabezado. */
function TablaMultiColumna({ columnas, filas, total }) {
  const idPaginacion = useId()
  const [orden, alternarOrden] = useOrdenTabla()

  const filasOrdenadas = useMemo(() => {
    if (!orden) return filas
    return [...filas].sort((a, b) => {
      const cmp = comparar(a[orden.columna], b[orden.columna])
      return orden.direccion === 'asc' ? cmp : -cmp
    })
  }, [filas, orden])

  const { filasPagina, mostrarPaginador, paginacion } = useTablaPaginada(
    filasOrdenadas, orden ? `${orden.columna}-${orden.direccion}` : 'sin-orden',
  )

  return (
    <>
      <Table responsive size="sm" className="mb-0">
        <thead>
          <tr>
            {columnas.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key -- el nombre de columna no es único: la
              // misma columna origen puede repetirse con un tipo de agregación distinto (sección 23)
              <EncabezadoOrdenable key={i} columna={i} alineadoDerecha={i > 0} ordenActivo={orden} onClick={() => alternarOrden(i)}>
                {c}
              </EncabezadoOrdenable>
            ))}
          </tr>
        </thead>
        <tbody>
          {filasPagina.map((fila, i) => (
            // eslint-disable-next-line react/no-array-index-key -- las filas no tienen un id propio
            <tr key={i}>
              {fila.map((valor, j) => (
                // eslint-disable-next-line react/no-array-index-key -- ídem, el nombre de columna puede repetirse
                <td key={j} className={j > 0 ? 'text-end' : undefined}>
                  {columnas[j] === 'Resultado' ? <BadgeResultado valor={valor} /> : celda(valor)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="fw-bold">
              {total.map((valor, j) => (
                // eslint-disable-next-line react/no-array-index-key -- ídem
                <td key={j} className={j > 0 ? 'text-end' : undefined}>{celda(valor)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </Table>
      {mostrarPaginador && <BarraPaginacion idBase={idPaginacion} paginacion={paginacion} />}
    </>
  )
}

/** Forma simple de dos columnas (`{categorias, valores}`, categoría/valor) — mismo criterio de
 * orden y paginación que `TablaMultiColumna`. */
function TablaSimple({ categorias, valores }) {
  const idPaginacion = useId()
  const [orden, alternarOrden] = useOrdenTabla()

  const filas = useMemo(
    () => (categorias || []).map((categoria, i) => ({ categoria, valor: valores?.[i] ?? 0 })),
    [categorias, valores],
  )
  const filasOrdenadas = useMemo(() => {
    if (!orden) return filas
    return [...filas].sort((a, b) => {
      const cmp = comparar(a[orden.columna], b[orden.columna])
      return orden.direccion === 'asc' ? cmp : -cmp
    })
  }, [filas, orden])

  const { filasPagina, mostrarPaginador, paginacion } = useTablaPaginada(
    filasOrdenadas, orden ? `${orden.columna}-${orden.direccion}` : 'sin-orden',
  )

  return (
    <>
      <Table responsive size="sm" className="mb-0">
        <thead>
          <tr>
            <EncabezadoOrdenable columna="categoria" ordenActivo={orden} onClick={() => alternarOrden('categoria')}>
              Categoría
            </EncabezadoOrdenable>
            <EncabezadoOrdenable columna="valor" alineadoDerecha ordenActivo={orden} onClick={() => alternarOrden('valor')}>
              Valor
            </EncabezadoOrdenable>
          </tr>
        </thead>
        <tbody>
          {filasPagina.map((fila) => (
            <tr key={fila.categoria}>
              <td>{fila.categoria}</td>
              <td className="text-end">{formatNumber(fila.valor)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {mostrarPaginador && <BarraPaginacion idBase={idPaginacion} paginacion={paginacion} />}
    </>
  )
}

/**
 * Renderiza un componente type=chart de tabla. Dos formas de datos posibles: la simple de dos
 * columnas (`TablaSimple`) o la de N columnas (`TablaMultiColumna`) — ver
 * `services/generic_charts.py::generar_datos_tabla`. Ambas permiten ordenar por cualquier columna
 * y, cuando hay más de 5 filas, elegir cuántas ver por página (el conjunto único de
 * `config/pageSizes.js`) con su propio
 * paginador. `mostrarHallazgos` (por defecto `true`) deja ocultar el párrafo de "Hallazgos
 * clave" — lo usa el modal "Ver archivo" del histórico de cargas, donde se muestra el archivo tal
 * cual (una previsualización cruda), no una interpretación de sus datos. `esHistorica` agrega una
 * etiqueta fija junto al título para la posición histórica (Tabla 3, ver
 * `TablaHistoricaAutomatica`) — es un prop controlado por quién renderiza la tabla, nunca algo
 * guardado en `content`/`mapeo`, así que ninguna edición de título/descripción puede quitarla.
 */
export default function GenericDataTable({ data, override, mostrarHallazgos = true, esHistorica = false, hallazgoIA }) {
  if (!data) return null
  const esMultiColumna = Array.isArray(data.columnas) && Array.isArray(data.filas)

  return (
    <div className="chart-panel" style={override?.colores?.colorFondo ? { background: override.colores.colorFondo } : undefined}>
      <div className="chart-panel__title" style={override?.colores?.colorTexto ? { color: override.colores.colorTexto } : undefined}>
        {override?.titulo || data.titulo}
        {esHistorica && <Badge bg="info" className="ms-2 align-middle">Histórica</Badge>}
      </div>
      {(override?.descripcion || data.descripcion) && (
        <div className="chart-panel__subtitle">{override?.descripcion || data.descripcion}</div>
      )}
      {esMultiColumna
        ? <TablaMultiColumna columnas={data.columnas} filas={data.filas} total={data.total} />
        : <TablaSimple categorias={data.categorias} valores={data.valores} />}
      {mostrarHallazgos && <HallazgosClaveCard variante="tabla" datos={data} textoIA={hallazgoIA} />}
    </div>
  )
}
