import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import GenericMultiLineChart from '../components/dashboard-generic/GenericMultiLineChart'

const DATA = {
  titulo: 'Ingresos vs. Gastos',
  categorias: ['Ene', 'Feb'],
  series: [
    { nombre: 'Ingresos (USD)', valores: [100, 120] },
    { nombre: 'Gastos (USD)', valores: [60, 70] },
  ],
}

describe('GenericMultiLineChart', () => {
  it('sin series, no renderiza nada', () => {
    const { container } = render(<GenericMultiLineChart data={{ titulo: 'Vacío', categorias: [], series: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('con datos, monta el gráfico con el título (recharts no dibuja SVG en jsdom, se verifica el montaje)', () => {
    render(<GenericMultiLineChart data={DATA} />)
    // El título aparece en el encabezado del chart-panel y en el nombre de la leyenda de recharts.
    expect(screen.getAllByText('Ingresos vs. Gastos').length).toBeGreaterThan(0)
  })

  it('muestra la descripción cuando viene en los datos', () => {
    render(<GenericMultiLineChart data={{ ...DATA, descripcion: 'Comparación mes a mes.' }} />)
    expect(screen.getByText('Comparación mes a mes.')).toBeInTheDocument()
  })
})
