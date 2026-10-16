import { Form, Spinner } from 'react-bootstrap'
import { useColumnasDelArchivo } from '../../hooks/useColumnasDelArchivo'

/**
 * Qué columnas del archivo muestra el detalle de la consulta por cliente.
 *
 * Las columnas se piden al backend en vez de guardarse en el layout: son del ARCHIVO, no del
 * diseño, y cambian cuando se carga uno nuevo. Una lista guardada envejecería en silencio y
 * ofrecería columnas que ya no existen.
 *
 * Las seleccionadas se guardan SIEMPRE en el orden del archivo, no en el orden en que se fueron
 * marcando: así el detalle se lee igual que la planilla de origen, que es lo que espera quien
 * compara las dos cosas.
 */
export default function SelectorColumnasDetalle({ dashboardId, seleccionadas, onCambiar }) {
  const { columnas, error } = useColumnasDelArchivo(dashboardId)

  if (error) return <p className="text-warning small mb-3">{error}</p>
  if (!columnas) return <Spinner animation="border" size="sm" className="mb-3" />

  const elegidas = seleccionadas || []

  function alternar(columna) {
    const nuevas = elegidas.includes(columna)
      ? elegidas.filter((c) => c !== columna)
      : columnas.filter((c) => c === columna || elegidas.includes(c))
    onCambiar(nuevas)
  }

  return (
    <div className="mb-3">
      <p className="text-secondary mb-2" style={{ fontSize: '0.8rem' }}>
        {elegidas.length} de {columnas.length} columnas · se muestran en el orden del archivo
      </p>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {columnas.map((columna) => (
          <Form.Check
            key={columna}
            type="checkbox"
            id={`columna-detalle-${columna}`}
            label={columna}
            checked={elegidas.includes(columna)}
            onChange={() => alternar(columna)}
            style={{ fontSize: '0.85rem' }}
          />
        ))}
      </div>
      {elegidas.length === 0 && (
        // Sin ninguna marcada el backend devuelve todas, que es mejor que una tabla vacía; se
        // avisa para que no parezca que la selección se perdió.
        <p className="text-secondary mt-2 mb-0" style={{ fontSize: '0.78rem' }}>
          Sin columnas elegidas se muestran todas.
        </p>
      )}
    </div>
  )
}
