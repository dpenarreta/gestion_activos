import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenericBarChart from '../components/dashboard-generic/GenericBarChart'
import GenericMultiLineChart from '../components/dashboard-generic/GenericMultiLineChart'

// Auditoría UX/UI, fase 3, 28/10/2026: cada gráfico es un <figure> con nombre y ofrece sus datos
// en una tabla (oculta a la vista, legible por lectores de pantalla, y visible con «Ver datos»).
const DATA = { titulo: 'Cartera vencida', categorias: ['Norte', 'Sur'], valores: [1500, 250] }

describe('FiguraGrafico (alternativa textual de los gráficos)', () => {
  it('el gráfico es una figura cuyo nombre es el título del componente', () => {
    render(<GenericBarChart data={DATA} />)
    expect(screen.getByRole('figure', { name: 'Cartera vencida' })).toBeInTheDocument()
  })

  it('el título personalizado (override) también nombra la figura y la tabla', () => {
    render(<GenericBarChart data={DATA} override={{ titulo: 'Vencida por zona' }} />)
    expect(screen.getByRole('figure', { name: 'Vencida por zona' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Datos de «Vencida por zona»' })).toBeInTheDocument()
  })

  it('ofrece los datos en una tabla, oculta a la vista hasta pulsar «Ver datos»', async () => {
    const user = userEvent.setup()
    render(<GenericBarChart data={DATA} />)
    const tabla = screen.getByRole('table', { name: 'Datos de «Cartera vencida»' })
    expect(tabla.parentElement).toHaveClass('visually-hidden')

    const encabezados = within(tabla).getAllByRole('columnheader').map((th) => th.textContent)
    expect(encabezados).toEqual(['Categoría', 'Valor'])
    const filas = within(tabla).getAllByRole('row').slice(1)
    expect(filas.map((fila) => within(fila).getByRole('rowheader').textContent)).toEqual(['Norte', 'Sur'])
    // es-EC usa punto como separador de miles, igual que los ejes y el tooltip.
    expect(within(filas[0]).getByRole('cell')).toHaveTextContent('1.500')

    // Cada «Ver datos» dice de qué gráfico es (hay varios en un dashboard).
    const boton = screen.getByRole('button', { name: 'Ver datos de «Cartera vencida»' })
    await user.click(boton)
    expect(tabla.parentElement).not.toHaveClass('visually-hidden')
    expect(screen.getByRole('button', { name: 'Ocultar datos de «Cartera vencida»' })).toBeInTheDocument()
  })

  it('en un gráfico de varias series, hay una columna por serie con su título de leyenda', () => {
    const datos = {
      titulo: 'Ingresos vs. gastos',
      categorias: ['Ene', 'Feb'],
      series: [
        { nombre: 'ingresos', valores: [100, 50] },
        { nombre: 'gastos', valores: [20, 10] },
      ],
    }
    render(<GenericMultiLineChart data={datos} override={{ colores: { etiquetasPorSerie: { ingresos: 'Ingresos' } } }} />)
    const tabla = screen.getByRole('table', { name: 'Datos de «Ingresos vs. gastos»' })
    const encabezados = within(tabla).getAllByRole('columnheader').map((th) => th.textContent)
    expect(encabezados).toEqual(['Categoría', 'Ingresos', 'gastos'])
    expect(within(tabla).getAllByRole('row')).toHaveLength(3)
  })
})
