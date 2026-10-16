import { describe, expect, it } from 'vitest'
import { contrastRatio, cumpleContrasteAA, luminanciaRelativa } from '../utils/colorContrast'

describe('colorContrast', () => {
  it('luminanciaRelativa: blanco es 1, negro es 0', () => {
    expect(luminanciaRelativa('#ffffff')).toBeCloseTo(1, 5)
    expect(luminanciaRelativa('#000000')).toBeCloseTo(0, 5)
  })

  it('contrastRatio: blanco contra negro es el máximo (21:1)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
  })

  it('contrastRatio: un color contra sí mismo es 1:1 (sin contraste)', () => {
    expect(contrastRatio('#2a78d6', '#2a78d6')).toBeCloseTo(1, 5)
  })

  it('contrastRatio: devuelve null si algún color no es un hex válido', () => {
    expect(contrastRatio('no-es-color', '#ffffff')).toBeNull()
    expect(contrastRatio('#ffffff', '')).toBeNull()
  })

  it('cumpleContrasteAA: blanco sobre negro cumple AA (4.5:1)', () => {
    expect(cumpleContrasteAA('#ffffff', '#000000')).toBe(true)
  })

  it('cumpleContrasteAA: un amarillo claro sobre blanco no cumple AA', () => {
    expect(cumpleContrasteAA('#ffc107', '#ffffff')).toBe(false)
  })

  it('cumpleContrasteAA: valores inválidos no bloquean (se asume que sí cumple)', () => {
    expect(cumpleContrasteAA('no-es-color', '#ffffff')).toBe(true)
  })
})
