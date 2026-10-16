import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import GenericTitleBlock from '../components/dashboard-generic/GenericTitleBlock'

describe('GenericTitleBlock', () => {
  it('muestra el título', () => {
    render(<GenericTitleBlock content={{ titulo: 'Resumen del mes' }} />)
    expect(screen.getByText('Resumen del mes')).toBeInTheDocument()
  })

  it('muestra la descripción cuando está presente', () => {
    render(<GenericTitleBlock content={{ titulo: 'Resumen del mes', descripcion: 'Vista general de ventas.' }} />)
    expect(screen.getByText('Vista general de ventas.')).toBeInTheDocument()
  })

  it('sin descripción, no muestra ningún subtítulo', () => {
    const { container } = render(<GenericTitleBlock content={{ titulo: 'Resumen del mes' }} />)
    expect(container.querySelector('.chart-panel__subtitle')).not.toBeInTheDocument()
  })
})
