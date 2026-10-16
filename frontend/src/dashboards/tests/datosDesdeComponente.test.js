import { describe, expect, it } from 'vitest'
import { datosDesdeComponente } from '../utils/datosDesdeComponente'

describe('datosDesdeComponente', () => {
  it('un KPI usa valor/formato/tendencia de content', () => {
    const resultado = datosDesdeComponente({
      type: 'kpi', content: { valor: 100, formato: 'moneda', tendencia: { valor: 5 } },
    })
    expect(resultado).toEqual({ datos: { valor: 100, formato: 'moneda', tendencia: { valor: 5 } } })
  })

  it('un KPI con meta también la incluye (regresión: se perdía al reconstruir `datos`)', () => {
    const meta = { meta_min: 50, meta_max: 200, cumple: true, motivos: [] }
    const resultado = datosDesdeComponente({ type: 'kpi', content: { valor: 100, formato: 'numero', meta } })
    expect(resultado.datos.meta).toEqual(meta)
  })

  it('dispersión usa los puntos', () => {
    const resultado = datosDesdeComponente({ type: 'chart', chart_type: 'dispersion', content: { puntos: [{ x: 1, y: 2 }] } })
    expect(resultado).toEqual({ datos: { puntos: [{ x: 1, y: 2 }] } })
  })

  it('tabla usa columnas/filas/total', () => {
    const resultado = datosDesdeComponente({
      type: 'chart', chart_type: 'tabla',
      content: { columnas: ['A'], filas: [[1]], total: [2] },
    })
    expect(resultado.datos).toEqual(expect.objectContaining({ columnas: ['A'], filas: [[1]], total: [2] }))
  })

  it('un chart_type multiserie clásico (barras_agrupadas) con content de series usa datosMultiserie', () => {
    const content = { categorias: ['Ene'], series: [{ nombre: 'A', valores: [1] }] }
    const resultado = datosDesdeComponente({ type: 'chart', chart_type: 'barras_agrupadas', content })
    expect(resultado).toEqual({ datosMultiserie: { categorias: ['Ene'], series: content.series } })
  })

  it('un chart_type de una sola columna (barras_verticales) con content categórico usa datos', () => {
    const content = { categorias: ['Ene'], valores: [10] }
    const resultado = datosDesdeComponente({ type: 'chart', chart_type: 'barras_verticales', content })
    expect(resultado).toEqual({ datos: { categorias: ['Ene'], valores: [10] } })
  })

  it('pastel/dona sobre un componente de 2+ columnas (content trae `series`) usa datosMultiserie, no datos — el colapso lo hace GenericChartRenderer', () => {
    const content = { categorias: ['Ene', 'Feb'], series: [{ nombre: 'Ingresos', valores: [10, 20] }, { nombre: 'Gastos', valores: [1, 2] }] }
    const resultado = datosDesdeComponente({ type: 'chart', chart_type: 'dona', content })
    expect(resultado).toEqual({ datosMultiserie: { categorias: content.categorias, series: content.series } })
  })

  it('pastel/dona sobre un componente de una sola columna (content trae `valores`, no `series`) usa datos tal cual', () => {
    const content = { categorias: ['Electrónica', 'Hogar'], valores: [700, 300] }
    const resultado = datosDesdeComponente({ type: 'chart', chart_type: 'pastel', content })
    expect(resultado).toEqual({ datos: { categorias: content.categorias, valores: content.valores } })
  })
})
