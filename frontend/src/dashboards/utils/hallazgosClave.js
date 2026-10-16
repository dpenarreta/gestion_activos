import { formatCurrency, formatNumber, formatPercent } from './format'

/**
 * Genera el párrafo de "hallazgos clave" (sección 25/26) de un componente del dashboard — un
 * único texto narrativo, con los números/nombres importantes resaltados entre `**dobles
 * asteriscos**` (el mismo criterio simple de "negrita" que interpreta `HallazgosClaveCard` al
 * dibujarlo), calculado en el momento a partir de los mismos datos que ya recibe el componente
 * para dibujarse (`datos`/`datosMultiserie`, iguales a los que despacha `GenericChartRenderer`),
 * nunca guardado ni cacheado: si cambian el tipo de gráfico, las columnas mapeadas o el archivo,
 * en el siguiente render se recalcula solo, sin ningún paso extra. Devuelve `''` cuando no hay
 * datos suficientes para decir algo.
 *
 * `variante` es una clasificación más gruesa que `tipoVisualizacion` — agrupa por la FORMA de los
 * datos, no por cómo se dibujan (p. ej. barras/líneas/pastel comparten la misma forma
 * `{categorias, valores}`, así que comparten el mismo párrafo):
 * - 'kpi': un único valor (`GenericKpiCard`).
 * - 'categorico': una serie `{categorias, valores}` (barras, líneas, pastel/dona).
 * - 'multiserie': varias series `{categorias, series:[{nombre, valores}]}` (agrupadas/apiladas,
 *   área apilada, líneas múltiples).
 * - 'dispersion': puntos `{puntos:[{x,y}]}`.
 * - 'tabla': `{columnas, filas, total}` o, si no hay columnas múltiples, la misma forma que
 *   'categorico'.
 *
 * Importante: `categorias`/`series` ya llegan ordenadas por VALOR desde el backend (no por
 * tiempo, aunque el tipo de gráfico elegido sea "líneas"), así que este párrafo habla siempre en
 * términos de magnitud/ranking ("la categoría con mayor valor es..."), nunca de tendencia
 * temporal ("aumentó a lo largo del tiempo") — afirmar eso sería inventar un orden cronológico
 * que los datos no garantizan.
 */
export function generarHallazgos(variante, { datos, datosMultiserie } = {}) {
  switch (variante) {
    case 'kpi':
      return hallazgosKpi(datos)
    case 'categorico':
      return hallazgosCategorico(datos?.categorias, datos?.valores)
    case 'multiserie':
      return hallazgosMultiserie(datosMultiserie)
    case 'dispersion':
      return hallazgosDispersion(datos)
    case 'tabla':
      return hallazgosTabla(datos)
    default:
      return ''
  }
}

function formatearValor(valor, formato) {
  if (formato === 'moneda') return formatCurrency(valor)
  if (formato === 'porcentaje') return formatPercent(valor)
  return formatNumber(valor)
}

function formatearCelda(valor) {
  return typeof valor === 'number' ? formatNumber(valor) : valor
}

function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : 0
}

function hallazgosKpi(datos) {
  if (!datos) return ''
  let texto = `El valor actual es **${formatearValor(datos.valor, datos.formato)}**.`
  if (datos.tendencia) {
    const direccion = datos.tendencia.valor >= 0 ? 'un aumento' : 'una disminución'
    const contexto = datos.tendencia.texto ? ` ${datos.tendencia.texto}` : ''
    texto += ` Representa ${direccion} del **${formatPercent(Math.abs(datos.tendencia.valor))}**${contexto}.`
  }
  if (datos.meta) {
    texto += datos.meta.cumple
      ? ' **Cumple** la meta configurada.'
      : ` **No cumple** la meta configurada (${datos.meta.motivos.join('; ')}).`
  }
  return texto
}

function hallazgosCategorico(categorias, valores) {
  if (!categorias?.length) return ''
  const pares = categorias.map((categoria, i) => ({ categoria, valor: valores?.[i] ?? 0 }))
  const total = pares.reduce((suma, p) => suma + p.valor, 0)
  const ordenados = [...pares].sort((a, b) => b.valor - a.valor)
  const top = ordenados[0]
  const menor = ordenados[ordenados.length - 1]

  let texto = `Hay ${categorias.length} categoría${categorias.length === 1 ? '' : 's'}, con un total de **${formatNumber(total)}**. `
  texto += `**${top.categoria}** tiene el mayor valor (${formatNumber(top.valor)}, **${formatPercent(porcentaje(top.valor, total))}** del total)`
  if (menor.categoria !== top.categoria) {
    texto += `, mientras que **${menor.categoria}** tiene el menor valor (${formatNumber(menor.valor)})`
  }
  texto += '.'
  if (ordenados.length >= 3) {
    const top3 = ordenados.slice(0, 3).reduce((suma, p) => suma + p.valor, 0)
    texto += ` Las 3 categorías principales concentran el **${formatPercent(porcentaje(top3, total))}** del total.`
  }
  return texto
}

function hallazgosMultiserie(datos) {
  const categorias = datos?.categorias || []
  const series = datos?.series || []
  if (!categorias.length || !series.length) return ''

  const totalesPorSerie = series.map((s) => ({
    nombre: s.nombre, total: (s.valores || []).reduce((suma, v) => suma + (v || 0), 0),
  }))
  const totalesPorCategoria = categorias.map((categoria, i) => ({
    categoria, total: series.reduce((suma, s) => suma + (s.valores?.[i] || 0), 0),
  }))
  const totalGeneral = totalesPorSerie.reduce((suma, s) => suma + s.total, 0)
  const serieTop = [...totalesPorSerie].sort((a, b) => b.total - a.total)[0]
  const categoriaTop = [...totalesPorCategoria].sort((a, b) => b.total - a.total)[0]

  let texto = `Se comparan **${series.length}** serie${series.length === 1 ? '' : 's'} a lo largo de **${categorias.length}** categoría${categorias.length === 1 ? '' : 's'}. `
  texto += `**${serieTop.nombre}** es la serie con mayor valor acumulado (${formatNumber(serieTop.total)}, **${formatPercent(porcentaje(serieTop.total, totalGeneral))}** del total)`
  if (series.length > 1) {
    texto += `, y **${categoriaTop.categoria}** es la categoría con mayor valor combinado entre todas las series (${formatNumber(categoriaTop.total)})`
  }
  texto += '.'
  return texto
}

function hallazgosDispersion(datos) {
  const puntos = datos?.puntos || []
  const n = puntos.length
  if (!n) return ''

  const xs = puntos.map((p) => p.x)
  const ys = puntos.map((p) => p.y)
  const mediaX = xs.reduce((a, b) => a + b, 0) / n
  const mediaY = ys.reduce((a, b) => a + b, 0) / n
  let covarianza = 0
  let varianzaX = 0
  let varianzaY = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mediaX
    const dy = ys[i] - mediaY
    covarianza += dx * dy
    varianzaX += dx * dx
    varianzaY += dy * dy
  }
  const correlacion = varianzaX && varianzaY ? covarianza / Math.sqrt(varianzaX * varianzaY) : 0
  const magnitud = Math.abs(correlacion)

  let texto = `Se analizaron **${n}** punto${n === 1 ? '' : 's'}. `
  if (magnitud >= 0.2) {
    const fuerza = magnitud >= 0.7 ? 'fuerte' : magnitud >= 0.4 ? 'moderada' : 'débil'
    const sentido = correlacion >= 0 ? 'positiva' : 'negativa'
    texto += `Existe una relación ${sentido} ${fuerza} entre ambas variables (coeficiente de correlación **${correlacion.toFixed(2)}**). `
  } else {
    texto += 'No se observa una relación clara entre ambas variables. '
  }
  texto += `El rango de valores va de **${formatNumber(Math.min(...xs))}** a **${formatNumber(Math.max(...xs))}** en el eje X, `
    + `y de **${formatNumber(Math.min(...ys))}** a **${formatNumber(Math.max(...ys))}** en el eje Y.`
  return texto
}

/** No toda columna aparte de la identidad de fila es necesariamente numérica (p. ej. una tabla
 * puede traer una segunda columna de texto como "Categoría" antes de las columnas de valor) —
 * busca la primera columna que sí lo sea en TODAS las filas, para no intentar "rankear" ni
 * mostrar como "mayor valor" una columna de texto. */
function primerIndiceColumnaNumerica(columnas, filas) {
  for (let i = 1; i < columnas.length; i += 1) {
    if (filas.every((fila) => typeof fila[i] === 'number')) return i
  }
  return null
}

function hallazgosTabla(datos) {
  if (!datos) return ''
  const esMultiColumna = Array.isArray(datos.columnas) && Array.isArray(datos.filas)
  if (!esMultiColumna) return hallazgosCategorico(datos.categorias, datos.valores)

  const { columnas, filas, total } = datos
  if (!filas?.length) return ''
  let texto = `La tabla tiene **${filas.length}** fila${filas.length === 1 ? '' : 's'} y **${columnas.length}** columna${columnas.length === 1 ? '' : 's'}. `

  const indiceValor = primerIndiceColumnaNumerica(columnas, filas)
  if (indiceValor !== null) {
    const nombreValor = columnas[indiceValor]
    const ordenadas = [...filas].sort((a, b) => b[indiceValor] - a[indiceValor])
    const top = ordenadas[0]
    texto += `**${top[0]}** tiene el mayor valor de "${nombreValor}" (**${formatearCelda(top[indiceValor])}**). `
  }
  if (total?.length > 1) {
    const partes = columnas
      .map((c, i) => [c, total[i]])
      .filter(([, valor], i) => i > 0 && valor !== undefined && valor !== null && valor !== '')
    if (partes.length) {
      texto += `En total: ${partes.map(([c, valor]) => `${c} = ${formatearCelda(valor)}`).join(', ')}.`
    }
  }
  return texto.trim()
}
