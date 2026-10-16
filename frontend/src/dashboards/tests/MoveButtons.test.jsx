import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveButtons from '../components/dashboard-editor/MoveButtons'

describe('MoveButtons', () => {
  it('llama a onMover con "inicio", "arriba", "abajo" y "fin" según el botón pulsado', async () => {
    const onMover = vi.fn()
    render(<MoveButtons onMover={onMover} deshabilitarArriba={false} deshabilitarAbajo={false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Mover al inicio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mover arriba' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mover abajo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mover al final' }))

    expect(onMover.mock.calls).toEqual([['inicio'], ['arriba'], ['abajo'], ['fin']])
  })

  it('deshabilitarArriba deshabilita "inicio" y "arriba" pero no "abajo"/"fin"', () => {
    render(<MoveButtons onMover={vi.fn()} deshabilitarArriba deshabilitarAbajo={false} />)

    expect(screen.getByRole('button', { name: 'Mover al inicio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover arriba' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover abajo' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover al final' })).not.toBeDisabled()
  })

  it('deshabilitarAbajo deshabilita "abajo" y "fin" pero no "inicio"/"arriba"', () => {
    render(<MoveButtons onMover={vi.fn()} deshabilitarArriba={false} deshabilitarAbajo />)

    expect(screen.getByRole('button', { name: 'Mover abajo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover al final' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover al inicio' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover arriba' })).not.toBeDisabled()
  })
})
