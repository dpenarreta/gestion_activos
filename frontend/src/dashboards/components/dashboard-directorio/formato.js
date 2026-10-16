/**
 * Formato de números del Dashboard Directorio.
 *
 * Vive separado de `comunes.jsx` porque un archivo que exporta componentes y además funciones
 * sueltas dispara `react(only-export-components)`: obliga a Vite a recargar la página entera al
 * editarlo en vez de intercambiar en caliente solo el componente. Mismo criterio que
 * `dashboard-generic/pieChartData.js`.
 *
 * Este dashboard replica una pestaña de un informe financiero impreso, así que usa el formato de
 * ese informe (`$3,388,555`: miles con coma, sin decimales) y no el `es-EC` del resto de la
 * aplicación (`$ 3.388.555,00`). Es deliberado y está acotado acá: `utils/format.js` sigue intacto
 * para todos los demás dashboards.
 */

/** `$3,388,555` — el formato del informe. */
export function moneda(valor) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  return `$${Math.round(valor).toLocaleString('en-US')}`
}

/** `62%` / `12.64%`, según los decimales que pida la sección. */
export function porcentaje(valor, decimales = 0) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  return `${valor.toFixed(decimales)}%`
}

/** `$2116K` — miles con K, sin decimales ni separador, como los ejes y etiquetas del informe. */
export function compacto(valor) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  return `$${Math.round(valor / 1000)}K`
}

/**
 * `junio 2026` — el mes y el año de una fecha ISO (`YYYY-MM-DD`), como los titula el informe.
 *
 * La fecha se parte a mano en vez de pasarla por `new Date('2026-06-30')`: ese constructor la
 * interpreta como UTC y, en una zona con desfase negativo (la de acá es UTC-5), la muestra como el
 * día anterior — un corte del 1 de julio aparecería como "junio". El informe titula por el mes del
 * corte, así que ese error se vería en la portada de la sección.
 */
/**
 * Ticks del eje Y en múltiplos redondos (`$0 · $500K · $1000K · …`), como los del informe.
 *
 * Recharts, librado a su criterio, reparte el eje en partes iguales del máximo real: con un tope de
 * $2.099K produce `$550K · $1100K · $1650K`, que se leen mal. Se redondea el tope hacia arriba al
 * siguiente múltiplo del paso y se generan los cortes a mano.
 */
export function ticksRedondos(maximo, paso = 500000) {
  if (!maximo || maximo <= 0) return undefined
  const tope = Math.ceil(maximo / paso) * paso
  const ticks = []
  for (let valor = 0; valor <= tope; valor += paso) ticks.push(valor)
  return ticks
}

export function mesYAnio(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes] = String(fechaIso).split('-')
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const nombre = meses[Number(mes) - 1]
  return nombre ? `${nombre} ${anio}` : null
}

/**
 * La fecha del corte, que viaja en el contenido del KPI total y titula varias secciones.
 *
 * Se lee de ahí en vez de repetirla en cada componente: es el mismo dato y, duplicado, dos
 * secciones podrían terminar anunciando cortes distintos después de un recálculo parcial.
 */
/**
 * `Resto (1130)` → `Resto (1,130 clientes)`, como lo nombra el informe.
 *
 * El cálculo genérico devuelve solo la cantidad, porque sirve para cualquier columna de identidad
 * (cliente, ciudad, recuperador). Acá se le agrega el separador de miles y el nombre de esa
 * columna en plural, que es lo que hace legible la fila en un informe impreso: "Resto (1,130)" no
 * dice de qué son esos 1.130.
 */
export function etiquetaResto(texto, columnaId) {
  const match = String(texto ?? '').match(/^(.*?)\((\d+)\)\s*$/)
  if (!match) return texto
  const [, prefijo, cantidad] = match
  const conSeparador = Number(cantidad).toLocaleString('en-US')
  if (!columnaId) return `${prefijo}(${conSeparador})`
  const nombre = String(columnaId).toLowerCase()
  const plural = /[aeiou]$/.test(nombre) ? `${nombre}s` : `${nombre}es`
  return `${prefijo}(${conSeparador} ${plural})`
}

export function corteDe(componentes) {
  return componentes?.find((c) => c.config?.es_base_porcentaje)?.content?.fecha_corte || null
}

/**
 * Reemplaza el marcador `{corte}` del título por el mes del corte, en mayúsculas
 * (`ANTIGÜEDAD DE CARTERA — AGOSTO 2026`).
 *
 * Va como marcador y no interpolado al sembrar, por el mismo motivo que `{n}` en el título de
 * concentración: el título es texto editable que se guarda una sola vez, así que con el mes ya
 * escrito quedaría anunciando el corte anterior en cuanto se cargue un archivo nuevo. Si no hay
 * corte conocido, el marcador se quita junto con el separador para no dejar un "— {corte}" suelto.
 */
export function conCorte(titulo, componentes) {
  if (!titulo) return titulo
  if (!titulo.includes('{corte}')) return titulo
  const corte = mesYAnio(corteDe(componentes))
  // Sin corte conocido se quita el marcador CON su puntuación: el informe lo usa de dos formas
  // ("— {corte}" y "({corte})"), y dejar solo el marcador fuera daría un "— " o un "()" colgando.
  if (!corte) {
    return titulo
      .replace(/\s*—\s*\{corte\}/, '')
      .replace(/\s*\(\{corte\}\)/, '')
      .replace('{corte}', '')
      .trim()
  }
  return titulo.replace('{corte}', corte.toUpperCase())
}
