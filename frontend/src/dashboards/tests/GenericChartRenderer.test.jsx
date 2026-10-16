import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import GenericChartRenderer from '../components/dashboard-generic/GenericChartRenderer'

const MULTISERIE = {
  categorias: ['Ene', 'Feb'],
  series: [
    { nombre: 'Ingresos', valores: [100, 50] },
    { nombre: 'Gastos', valores: [20, 10] },
  ],
}

describe('GenericChartRenderer — pastel/dona sobre posiciones de 2+ columnas (multivalor/multiserie)', () => {
  it('con dona y datosMultiserie (sin datos), colapsa las series sumadas por categoría — el total refleja todas las columnas', () => {
    const { container } = render(
      <GenericChartRenderer
        tipoVisualizacion="dona" datosMultiserie={MULTISERIE} config={{ mostrar_total: true }}
      />,
    )
    // 100+20 (Ene) + 50+10 (Feb) = 180: la suma de TODAS las series, no solo la primera.
    const total = within(container.querySelector('.pie-chart__total'))
    expect(total.getByText('180')).toBeInTheDocument()
  })

  it('con pastel y datosMultiserie, dibuja una porción por categoría (no por serie)', () => {
    render(<GenericChartRenderer tipoVisualizacion="pastel" datosMultiserie={MULTISERIE} />)
    expect(screen.getByText('Ene')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
    expect(screen.queryByText('Ingresos')).not.toBeInTheDocument()
    expect(screen.queryByText('Gastos')).not.toBeInTheDocument()
  })

  it('si ya viene `datos` (posición de una sola columna), lo usa directo y no toca datosMultiserie', () => {
    const { container } = render(
      <GenericChartRenderer
        tipoVisualizacion="dona"
        datos={{ categorias: ['A', 'B'], valores: [7, 3] }}
        datosMultiserie={MULTISERIE}
        config={{ mostrar_total: true }}
      />,
    )
    const total = within(container.querySelector('.pie-chart__total'))
    expect(total.getByText('10')).toBeInTheDocument()
    expect(screen.queryByText('180')).not.toBeInTheDocument()
  })

  it('sin datos ni datosMultiserie, no rompe (no dibuja nada)', () => {
    const { container } = render(<GenericChartRenderer tipoVisualizacion="pastel" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('un tipo de visualización multiserie (no circular) sigue usando datosMultiserie tal cual, sin colapsar', () => {
    render(<GenericChartRenderer tipoVisualizacion="barras_agrupadas" datosMultiserie={MULTISERIE} />)
    // El párrafo de "hallazgos clave" de una posición multiserie habla de "series" (mencionando
    // "Ingresos", la de mayor valor acumulado) — a diferencia del que arma para una posición
    // colapsada a categórico ("Hay N categorías, con un total de..."), prueba de que acá NO se
    // colapsó (a diferencia de pastel/dona).
    expect(screen.getByText(/Se comparan/)).toBeInTheDocument()
    expect(screen.getAllByText('Ingresos').length).toBeGreaterThan(0)
  })

  it('con barras_verticales y datosMultiserie (sin datos), colapsa las series sumadas por categoría', () => {
    render(<GenericChartRenderer tipoVisualizacion="barras_verticales" datosMultiserie={MULTISERIE} />)
    // Mismo criterio que pastel/dona: el hallazgo "categórico" confirma que sumó Ingresos+Gastos
    // por categoría (100+20 Ene, 50+10 Feb = 180 en total) en vez de quedarse sin dibujar nada.
    expect(screen.getByText(/Hay 2 categorías, con un total de/)).toBeInTheDocument()
    expect(screen.getByText('180')).toBeInTheDocument()
  })

  it('con barras_horizontales y datosMultiserie (sin datos), colapsa las series sumadas por categoría', () => {
    render(<GenericChartRenderer tipoVisualizacion="barras_horizontales" datosMultiserie={MULTISERIE} />)
    expect(screen.getByText(/Hay 2 categorías, con un total de/)).toBeInTheDocument()
    expect(screen.getByText('180')).toBeInTheDocument()
  })

  it('barras_verticales con `datos` ya presente (posición de una sola columna) lo usa directo, sin tocar datosMultiserie', () => {
    render(
      <GenericChartRenderer
        tipoVisualizacion="barras_verticales"
        datos={{ categorias: ['A', 'B'], valores: [7, 3] }}
        datosMultiserie={MULTISERIE}
      />,
    )
    expect(screen.getByText(/Hay 2 categorías, con un total de/)).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.queryByText('180')).not.toBeInTheDocument()
  })
})
