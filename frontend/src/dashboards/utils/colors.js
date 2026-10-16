export const PALETA_CATEGORICA = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
]

function hash(texto) {
  let h = 0
  for (let i = 0; i < texto.length; i += 1) {
    h = (h * 31 + texto.charCodeAt(i)) >>> 0
  }
  return h
}

/** Asigna un color estable por identidad (nombre), no por posición/ranking. */
export function colorPorIdentidad(nombre) {
  const indice = hash(String(nombre || '')) % PALETA_CATEGORICA.length
  return PALETA_CATEGORICA[indice]
}
