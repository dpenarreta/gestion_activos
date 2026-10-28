import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveButtons from '../components/dashboard-editor/MoveButtons'

describe('MoveButtons', () => {
  it('llama a onMover con "inicio", "arriba", "abajo" y "fin" según el botón pulsado', async () => {
    const onMover = vi.fn()
    render(<MoveButtons onMover={onMover} deshabilitarArriba={false} deshabilitarAbajo={false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Mover al inicio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mover antes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mover después' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mover al final' }))

    expect(onMover.mock.calls).toEqual([['inicio'], ['arriba'], ['abajo'], ['fin']])
  })

  it('deshabilitarArriba deshabilita "inicio" y "arriba" (antes) pero no "abajo"/"fin"', () => {
    render(<MoveButtons onMover={vi.fn()} deshabilitarArriba deshabilitarAbajo={false} />)

    expect(screen.getByRole('button', { name: 'Mover al inicio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover antes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover después' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover al final' })).not.toBeDisabled()
  })

  it('deshabilitarAbajo deshabilita "abajo" y "fin" pero no "inicio"/"arriba"', () => {
    render(<MoveButtons onMover={vi.fn()} deshabilitarArriba={false} deshabilitarAbajo />)

    expect(screen.getByRole('button', { name: 'Mover después' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover al final' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover al inicio' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover antes' })).not.toBeDisabled()
  })

  it('con nombre, cada botón y el grupo dicen qué componente mueven', () => {
    render(<MoveButtons onMover={vi.fn()} deshabilitarArriba={false} deshabilitarAbajo={false} nombre="Cartera vencida" />)

    expect(screen.getByRole('group', { name: 'Mover "Cartera vencida"' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mover "Cartera vencida" al inicio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mover "Cartera vencida" antes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mover "Cartera vencida" después' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mover "Cartera vencida" al final' })).toBeInTheDocument()
  })
})
