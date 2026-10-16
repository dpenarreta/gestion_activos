const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function hexANormalizado(hex) {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function canalLineal(canal) {
  const c = canal / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Luminancia relativa (WCAG 2.x, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
export function luminanciaRelativa(hex) {
  const normalizado = hexANormalizado(hex)
  const r = parseInt(normalizado.slice(1, 3), 16)
  const g = parseInt(normalizado.slice(3, 5), 16)
  const b = parseInt(normalizado.slice(5, 7), 16)
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b)
}

/** Razón de contraste WCAG entre dos colores hex (1 = sin contraste, 21 = máximo). */
export function contrastRatio(hexA, hexB) {
  if (!HEX_RE.test(hexA || '') || !HEX_RE.test(hexB || '')) return null
  const l1 = luminanciaRelativa(hexA)
  const l2 = luminanciaRelativa(hexB)
  const claro = Math.max(l1, l2)
  const oscuro = Math.min(l1, l2)
  return (claro + 0.05) / (oscuro + 0.05)
}

/**
 * `true` si el contraste alcanza el mínimo WCAG AA para texto normal (4.5:1). Se usa para
 * advertir (no bloquear, sección de accesibilidad del Módulo B) cuando un color institucional
 * elegido no es legible contra blanco/negro.
 */
export function cumpleContrasteAA(hexA, hexB) {
  const ratio = contrastRatio(hexA, hexB)
  return ratio === null ? true : ratio >= 4.5
}
