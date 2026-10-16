import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import GenericPieChart from '../components/dashboard-generic/GenericPieChart'
import { datosCircularConEtiquetas } from '../components/dashboard-generic/pieChartData'

const DATA = { titulo: 'Distribución', categorias: ['Electrónica', 'Hogar'], valores: [700, 300] }

describe('GenericPieChart', () => {
  it('sin mostrarTotal, no dibuja el total centrado', () => {
    render(<GenericPieChart data={DATA} dona />)
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  it('con mostrarTotal y dona, dibuja la suma de los valores centrada', () => {
    const { container } = render(<GenericPieChart data={DATA} dona mostrarTotal />)
    const total = within(container.querySelector('.pie-chart__total'))
    expect(total.getByText('Total')).toBeInTheDocument()
    // 700 + 300 = 1.000 (es-EC usa punto como separador de miles).
    expect(total.getByText('1.000')).toBeInTheDocument()
  })

  it('mostrarTotal sin dona (pastel simple) no dibuja el total, porque no hay agujero central', () => {
    render(<GenericPieChart data={DATA} mostrarTotal />)
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  it('sin override, no rompe (sigue renderizando)', () => {
    const { container } = render(<GenericPieChart data={DATA} />)
    expect(container.querySelector('.chart-panel')).toBeInTheDocument()
  })
})

describe('datosCircularConEtiquetas', () => {
  it('sin etiquetasPorCategoria, usa la categoría real como nombre e id', () => {
    const resultado = datosCircularConEtiquetas(DATA)
    expect(resultado).toEqual([
      { id: 'Electrónica', nombre: 'Electrónica', valor: 700 },
      { id: 'Hogar', nombre: 'Hogar', valor: 300 },
    ])
  })

  it('con etiquetasPorCategoria, el título personalizado reemplaza el nombre visible pero no el id', () => {
    const resultado = datosCircularConEtiquetas(DATA, { Electrónica: 'Tech' })
    expect(resultado[0]).toEqual({ id: 'Electrónica', nombre: 'Tech', valor: 700 })
    // La categoría sin título personalizado conserva su nombre real.
    expect(resultado[1]).toEqual({ id: 'Hogar', nombre: 'Hogar', valor: 300 })
  })

  it('una etiqueta vacía ("") no reemplaza el nombre real (mismo criterio que "sin elegir")', () => {
    const resultado = datosCircularConEtiquetas(DATA, { Electrónica: '' })
    expect(resultado[0].nombre).toBe('Electrónica')
  })
})
