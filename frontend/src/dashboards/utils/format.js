const SIMBOLOS = { USD: '$' }

export function formatCurrency(value, currency = 'USD') {
  const numero = new Intl.NumberFormat('es-EC', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0)
  const simbolo = SIMBOLOS[currency] || `${currency} `
  return `${simbolo} ${numero}`
}

export function formatNumber(value) {
  return new Intl.NumberFormat('es-EC').format(value ?? 0)
}

export function formatPercent(value) {
  const numero = new Intl.NumberFormat('es-EC', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0)
  return `${numero}%`
}

export function formatDate(isoString) {
  if (!isoString) return '—'
  const [anio, mes, dia] = isoString.split('-')
  if (!anio || !mes || !dia) return isoString
  return `${dia}/${mes}/${anio}`
}
