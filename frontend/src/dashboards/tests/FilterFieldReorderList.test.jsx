import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterFieldReorderList from '../components/dashboard-editor/FilterFieldReorderList'

function filtroDePrueba(id, order, extra = {}) {
  return { id, label: id, order, width: 2, is_visible: true, is_required: false, ...extra }
}

describe('FilterFieldReorderList', () => {
  it('mueve un campo hacia arriba intercambiándolo con el anterior', async () => {
    const onCambiar = vi.fn()
    const filtros = [filtroDePrueba('ciudad', 1), filtroDePrueba('zona', 2), filtroDePrueba('sucursal', 3)]
    render(<FilterFieldReorderList filtros={filtros} onCambiar={onCambiar} />)

    const filaZona = screen.getByDisplayValue('zona').closest('tr')
    await userEvent.click(within(filaZona).getByRole('button', { name: 'Mover arriba' }))

    const resultado = onCambiar.mock.calls[0][0]
    expect(resultado.map((f) => f.id)).toEqual(['zona', 'ciudad', 'sucursal'])
    expect(resultado.map((f) => f.order)).toEqual([1, 2, 3])
  })

  it('el primer campo tiene deshabilitados "inicio"/"arriba" y el último "abajo"/"fin"', () => {
    const filtros = [filtroDePrueba('ciudad', 1), filtroDePrueba('zona', 2)]
    render(<FilterFieldReorderList filtros={filtros} onCambiar={vi.fn()} />)

    const filaCiudad = screen.getByDisplayValue('ciudad').closest('tr')
    const filaZona = screen.getByDisplayValue('zona').closest('tr')

    expect(within(filaCiudad).getByRole('button', { name: 'Mover arriba' })).toBeDisabled()
    expect(within(filaZona).getByRole('button', { name: 'Mover abajo' })).toBeDisabled()
  })

  it('destildar el checkbox "Visible" actualiza is_visible de ese campo sin afectar a los demás', async () => {
    const onCambiar = vi.fn()
    const filtros = [filtroDePrueba('ciudad', 1), filtroDePrueba('zona', 2)]
    render(<FilterFieldReorderList filtros={filtros} onCambiar={onCambiar} />)

    await userEvent.click(screen.getByLabelText('Mostrar filtro ciudad'))

    const resultado = onCambiar.mock.calls[0][0]
    expect(resultado.find((f) => f.id === 'ciudad').is_visible).toBe(false)
    expect(resultado.find((f) => f.id === 'zona').is_visible).toBe(true)
  })

  it('cambiar la etiqueta de un campo invoca onCambiar con la nueva etiqueta', () => {
    const onCambiar = vi.fn()
    const filtros = [filtroDePrueba('ciudad', 1, { label: 'Ciudad' })]
    render(<FilterFieldReorderList filtros={filtros} onCambiar={onCambiar} />)

    const campo = screen.getByDisplayValue('Ciudad')
    campo.focus()
    fireEvent.change(campo, { target: { value: 'Ciudad del cliente' } })

    expect(onCambiar).toHaveBeenCalledWith([expect.objectContaining({ id: 'ciudad', label: 'Ciudad del cliente' })])
  })
})
