import { Form, Spinner } from 'react-bootstrap'
import { useColumnasDelArchivo } from '../../hooks/useColumnasDelArchivo'

/**
 * Qué columna del archivo identifica al cliente (RUC, cédula, código) en la consulta por cliente.
 *
 * Es opcional y lo decide quien arma el dashboard, porque no todos los orígenes la traen: la
 * vista de producción, por ejemplo, devuelve el nombre y nada más. Cuando no hay ninguna elegida,
 * la identidad del cliente ES su nombre, y de ahí se siguen dos cosas que conviene entender antes
 * de dejarla vacía:
 *
 * - No se puede buscar por identificador (no hay dónde).
 * - Dos clientes homónimos son indistinguibles: sus saldos se suman como si fueran uno, y el
 *   aviso de identidad dudosa no tiene con qué contrastar.
 *
 * Elegirla no requiere tocar código ni volver a sembrar el dashboard: en cuanto el origen traiga
 * la columna, se marca acá y el buscador empieza a usarla.
 */
export default function SelectorColumnaIdentificador({ dashboardId, valor, onCambiar }) {
  const { columnas, error } = useColumnasDelArchivo(dashboardId)

  if (error) return <p className="text-warning small mb-3">{error}</p>
  if (!columnas) return <Spinner animation="border" size="sm" className="mb-3" />

  // Una columna elegida que el archivo ya no trae se conserva en la lista: quitarla de la vista
  // haría parecer que no hay nada configurado, cuando lo que pasa es que el mapeo quedó viejo.
  const opciones = valor && !columnas.includes(valor) ? [valor, ...columnas] : columnas

  return (
    <div className="mb-3">
      <Form.Select
        size="sm"
        value={valor || ''}
        onChange={(e) => onCambiar(e.target.value)}
        aria-label="Columna que identifica al cliente"
      >
        <option value="">(ninguna — se identifica por el nombre)</option>
        {opciones.map((columna) => (
          <option key={columna} value={columna}>{columna}</option>
        ))}
      </Form.Select>
      {!valor && (
        <p className="text-secondary mt-2 mb-0" style={{ fontSize: '0.78rem' }}>
          Sin identificador no se puede buscar por RUC y dos clientes con el mismo nombre se
          cuentan como uno solo.
        </p>
      )}
      {Boolean(valor) && !columnas.includes(valor) && (
        <p className="text-warning mt-2 mb-0" style={{ fontSize: '0.78rem' }}>
          El archivo cargado no trae «{valor}»: mientras no exista, la búsqueda usa solo el nombre.
        </p>
      )}
    </div>
  )
}
