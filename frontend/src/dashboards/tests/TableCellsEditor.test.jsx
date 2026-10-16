import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TableCellsEditor from '../components/dashboard-editor/TableCellsEditor'

const COLUMNAS = ['Cliente', 'Saldo']
const FILAS = [['A', 100], ['B', 200]]
const TOTAL = ['Total', 300]

function renderEditor(overrides = {}) {
  const props = {
    columnas: COLUMNAS, filas: FILAS, total: TOTAL,
    onCambiarFilas: vi.fn(), onCambiarTotal: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<TableCellsEditor {...props} />) }
}

describe('TableCellsEditor', () => {
  it('no renderiza nada si columnas o filas no son arrays', () => {
    const { container } = renderEditor({ columnas: undefined })
    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza el encabezado, las filas y la fila de total', () => {
    renderEditor()
    expect(screen.getByText('Cliente')).toBeInTheDocument()
    expect(screen.getByText('Saldo')).toBeInTheDocument()
    expect(screen.getByLabelText('Cliente — fila 1')).toHaveValue('A')
    expect(screen.getByLabelText('Saldo — fila 1')).toHaveValue('100')
    expect(screen.getByLabelText('Cliente — total')).toHaveValue('Total')
    expect(screen.getByLabelText('Saldo — total')).toHaveValue('300')
  })

  it('no renderiza la fila de total cuando no viene', () => {
    renderEditor({ total: undefined })
    expect(screen.queryByLabelText('Saldo — total')).not.toBeInTheDocument()
  })

  it('confirmar un valor numérico válido en onBlur invoca onCambiarFilas con solo esa celda cambiada', () => {
    const { props } = renderEditor()
    const campo = screen.getByLabelText('Saldo — fila 1')

    fireEvent.change(campo, { target: { value: '150' } })
    fireEvent.blur(campo)

    expect(props.onCambiarFilas).toHaveBeenCalledWith([['A', 150], ['B', 200]])
  })

  it('confirmar un valor numérico inválido no invoca onCambiarFilas y muestra un error', () => {
    const { props } = renderEditor()
    const campo = screen.getByLabelText('Saldo — fila 1')

    fireEvent.change(campo, { target: { value: 'no-numero' } })
    fireEvent.blur(campo)

    expect(props.onCambiarFilas).not.toHaveBeenCalled()
    expect(screen.getByText('Debe ser un número.')).toBeInTheDocument()
    // El texto tecleado no se pierde aunque no sea válido todavía.
    expect(campo).toHaveValue('no-numero')
  })

  it('una celda de texto no exige formato numérico', () => {
    const { props } = renderEditor()
    const campo = screen.getByLabelText('Cliente — fila 1')

    fireEvent.change(campo, { target: { value: 'Otro nombre' } })
    fireEvent.blur(campo)

    expect(props.onCambiarFilas).toHaveBeenCalledWith([['Otro nombre', 100], ['B', 200]])
  })

  it('editar el total invoca onCambiarTotal con el arreglo completo', () => {
    const { props } = renderEditor()
    const campo = screen.getByLabelText('Saldo — total')

    fireEvent.change(campo, { target: { value: '999' } })
    fireEvent.blur(campo)

    expect(props.onCambiarTotal).toHaveBeenCalledWith(['Total', 999])
  })

  it('no invoca el callback si el valor no cambió', () => {
    const { props } = renderEditor()
    const campo = screen.getByLabelText('Saldo — fila 1')

    fireEvent.change(campo, { target: { value: '100' } })
    fireEvent.blur(campo)

    expect(props.onCambiarFilas).not.toHaveBeenCalled()
  })
})
