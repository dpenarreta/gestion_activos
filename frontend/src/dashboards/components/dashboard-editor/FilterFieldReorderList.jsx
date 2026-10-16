import { Form, Table } from 'react-bootstrap'
import MoveButtons from './MoveButtons'

/**
 * Los 16 campos de filtro se reordenan dentro de su propio panel con una lista simple de
 * mover arriba/abajo (sección 12) — no se mezclan con el grid 2D de gráficos/KPIs.
 */
export default function FilterFieldReorderList({ filtros, onCambiar }) {
  const ordenados = [...filtros].sort((a, b) => a.order - b.order)

  const mover = (id, direccion) => {
    const indice = ordenados.findIndex((f) => f.id === id)
    if (indice === -1) return
    let destino = indice
    if (direccion === 'arriba') destino = Math.max(0, indice - 1)
    else if (direccion === 'abajo') destino = Math.min(ordenados.length - 1, indice + 1)
    else if (direccion === 'inicio') destino = 0
    else if (direccion === 'fin') destino = ordenados.length - 1
    if (destino === indice) return

    const copia = [...ordenados]
    const [item] = copia.splice(indice, 1)
    copia.splice(destino, 0, item)
    onCambiar(copia.map((f, i) => ({ ...f, order: i + 1 })))
  }

  const actualizarCampo = (id, cambios) => {
    onCambiar(ordenados.map((f) => (f.id === id ? { ...f, ...cambios } : f)))
  }

  return (
    <div className="table-scroll">
      <Table size="sm" bordered>
        <thead>
          <tr>
            <th>Orden</th>
            <th>Etiqueta</th>
            <th>Visible</th>
            <th>Obligatorio</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((f, i) => (
            <tr key={f.id}>
              <td><MoveButtons onMover={(dir) => mover(f.id, dir)} deshabilitarArriba={i === 0} deshabilitarAbajo={i === ordenados.length - 1} /></td>
              <td>
                <Form.Control
                  size="sm"
                  value={f.label}
                  onChange={(e) => actualizarCampo(f.id, { label: e.target.value })}
                  maxLength={60}
                />
              </td>
              <td className="text-center">
                <Form.Check type="checkbox" checked={f.is_visible} onChange={(e) => actualizarCampo(f.id, { is_visible: e.target.checked })} aria-label={`Mostrar filtro ${f.label}`} />
              </td>
              <td className="text-center">
                <Form.Check type="checkbox" checked={f.is_required} onChange={(e) => actualizarCampo(f.id, { is_required: e.target.checked })} aria-label={`Filtro ${f.label} obligatorio`} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
