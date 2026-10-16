import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../utils/format'

describe('formatCurrency', () => {
  it('usa separador de miles con punto y decimales con coma', () => {
    expect(formatCurrency(1581042.54)).toBe('$ 1.581.042,54')
  })

  it('usa 0 cuando el valor es nulo o indefinido', () => {
    expect(formatCurrency(null)).toBe('$ 0,00')
    expect(formatCurrency(undefined)).toBe('$ 0,00')
  })
})

describe('formatNumber', () => {
  it('agrupa miles', () => {
    expect(formatNumber(2281)).toBe('2.281')
  })
})

describe('formatPercent', () => {
  it('agrega el simbolo de porcentaje con dos decimales', () => {
    expect(formatPercent(19.14)).toBe('19,14%')
  })
})

describe('formatDate', () => {
  it('convierte ISO a DD/MM/YYYY', () => {
    expect(formatDate('2026-06-30')).toBe('30/06/2026')
  })

  it('devuelve un guion cuando no hay fecha', () => {
    expect(formatDate(null)).toBe('—')
  })
})
