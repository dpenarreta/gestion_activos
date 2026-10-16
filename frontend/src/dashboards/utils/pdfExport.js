import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// Mientras se genera el PDF, el `<html>` lleva esta clase — la regla en `styles/dashboard.css`
// (`.generando-pdf .d-print-none { display: none !important; }`) oculta de VERDAD (no solo
// `@media print`, que no aplica acá) el mismo chrome que ya se marcaba con `d-print-none`
// (sidebar, pestañas, botones, "Hallazgos clave"). Hace falta ocultarlo de verdad, no solo con
// `ignoreElements` de html2canvas, porque las medidas de cada tarjeta (`medirZonasProhibidas`) se
// toman ANTES de capturar — si "Hallazgos clave" siguiera visible al medir pero desaparecido al
// capturar, la altura medida de esa tarjeta no coincidiría con la altura real ya capturada, y la
// paginación cortaría en el lugar equivocado.
const CLASE_GENERANDO_PDF = 'generando-pdf'

// Selector de los bloques "atómicos" del dashboard (KPI, gráfico, tabla, título/separador) — ver
// `.claude/rules/dashboards.md` y cada `Generic*.jsx`, todos comparten una de estas 2 clases como
// contenedor raíz. Ninguno debe quedar partido a la mitad entre 2 hojas del PDF.
const SELECTOR_BLOQUES_ATOMICOS = '.chart-panel, .kpi-card'

// Margen parejo en los 4 lados de cada hoja (mismo valor que el padding de `.cartera-app` en
// pantalla, `styles/dashboard.css`) — sin esto, el contenido queda pegado al borde de cada hoja
// (sobre todo notorio en la última, ahora que se recorta a su alto real).
const MARGEN_PT = 24

function medirZonasProhibidas(elemento) {
  const contenedorTop = elemento.getBoundingClientRect().top
  return [...elemento.querySelectorAll(SELECTOR_BLOQUES_ATOMICOS)].map((nodo) => {
    const rect = nodo.getBoundingClientRect()
    return { top: rect.top - contenedorTop, bottom: rect.bottom - contenedorTop }
  })
}

// Si `propuesto` (el próximo corte de página, a `altoPaginaMax` de distancia del anterior) cae
// DENTRO de una tarjeta, retrocede el corte hasta el borde superior de esa tarjeta — así la
// tarjeta entera pasa completa a la hoja siguiente en vez de partirse. Excepción: si esa tarjeta
// ya venía partiéndose desde la hoja anterior (`zona.top <= cursor`, es más alta que una hoja
// completa), no hay corte seguro posible acá — se aceptar partirla, es la única salida.
function corteSeguro(propuesto, zonas, cursor) {
  const zona = zonas.find((z) => z.top < propuesto && propuesto < z.bottom)
  if (!zona || zona.top <= cursor) return propuesto
  return zona.top
}

function componentesRGB(colorCss) {
  const match = colorCss.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [255, 255, 255]
}

// Convierte el rango [inicioPt, finPt) (espacio PDF, pt) al rango de filas del canvas capturado
// que le corresponde — función pura, sin tocar el DOM, para poder probarla sin un `<canvas>` real.
function limitesRecortePx(inicioPt, finPt, canvasPxPorPt, altoCanvasTotal) {
  const inicioPx = Math.round(inicioPt * canvasPxPorPt)
  const finPx = Math.min(altoCanvasTotal, Math.round(finPt * canvasPxPorPt))
  return { inicioPx, altoPx: Math.max(1, finPx - inicioPx) }
}

// Recorta del canvas capturado (completo, una sola vez) solo la franja de esta hoja — cada hoja
// necesita SU PROPIO recorte, no la imagen completa con un offset: `addImage` no recorta, dibuja
// la imagen entera escalada al tamaño que se le pida, así que reusar la imagen completa en cada
// hoja (moviendo solo dónde "empieza") hacía que la hoja actual igual mostrara una ventana de
// altura fija completa — de ahí el contenido duplicado/superpuesto entre hojas y el margen enorme
// en la última hoja (la imagen ya no tenía más contenido real para esa altura, pero la hoja seguía
// siendo de tamaño completo). Recortar de antemano evita ambos problemas: cada hoja mide
// exactamente lo que le corresponde, ni más ni menos.
function recortarCanvas(canvasOriginal, inicioPx, altoPx) {
  const recorte = document.createElement('canvas')
  recorte.width = canvasOriginal.width
  recorte.height = altoPx
  recorte.getContext('2d').drawImage(canvasOriginal, 0, inicioPx, canvasOriginal.width, altoPx, 0, 0, canvasOriginal.width, altoPx)
  return recorte.toDataURL('image/png')
}

/**
 * Genera un PDF a partir de una captura del `elemento` dado (no del pipeline nativo de impresión
 * del navegador): `window.print()` + `@media print` se probó primero y se descartó — Recharts
 * mide su tamaño una sola vez con `ResizeObserver`, y la foto de impresión de Chrome la toma en
 * un instante intermedio antes de que ese observer termine de recalcular, dejando gráficos
 * (sobre todo los circulares, cuyo radio es un % del tamaño medido) reducidos a una fracción de
 * su tamaño real. Capturar el DOM ya renderizado en pantalla con `html2canvas` evita ese problema
 * de raíz: no depende de ninguna re-medición, es exactamente lo que el usuario ya ve.
 *
 * La paginación NO corta cada `altoPaginaMax` a ciegas (eso partía tablas/gráficos a la mitad
 * entre 2 hojas) — retrocede cada corte hasta el borde de la tarjeta más cercana (`corteSeguro`).
 * Y cada hoja se redimensiona a la altura REAL de lo que le tocó, MÁS `MARGEN_PT` (`setHeight`/
 * `addPage([ancho, alto])`, en vez de usar siempre el alto fijo de una A4) — así ninguna hoja, ni
 * siquiera la última, le sobra un margen en blanco desproporcionado al final, pero tampoco queda
 * el contenido pegado a ningún borde: el PDF termina justo donde termina el contenido MÁS el
 * margen parejo de los 4 lados. `colorFondo` pinta el fondo de cada hoja completa (incluida la
 * franja del margen) para que sea el mismo color de fondo del dashboard, no blanco.
 *
 * Contrapartida conocida y aceptada: el PDF resultante es una imagen rasterizada (no hay texto
 * seleccionable/buscable dentro del PDF) — se prioriza fidelidad visual sobre esa capacidad.
 */
export async function generarPDFDesdeElemento(elemento, nombreArchivo) {
  document.documentElement.classList.add(CLASE_GENERANDO_PDF)
  try {
    const colorFondo = getComputedStyle(document.body).backgroundColor
    const anchoElementoCss = elemento.getBoundingClientRect().width
    const zonasProhibidasCss = medirZonasProhibidas(elemento)

    const canvas = await html2canvas(elemento, { scale: 2, useCORS: true, backgroundColor: colorFondo })

    const pdf = new jsPDF('p', 'pt', 'a4')
    const anchoPagina = pdf.internal.pageSize.getWidth()
    // El contenido (imagen) se dibuja más angosto que la hoja, y cada hoja se arma más alta que
    // ese contenido — así queda `MARGEN_PT` libre en los 4 lados en vez de pegado al borde.
    const anchoImagen = anchoPagina - MARGEN_PT * 2
    const altoPaginaMax = pdf.internal.pageSize.getHeight() - MARGEN_PT * 2
    const altoImagen = (canvas.height * anchoImagen) / canvas.width

    const escala = anchoImagen / anchoElementoCss
    const zonasProhibidas = zonasProhibidasCss.map((z) => ({ top: z.top * escala, bottom: z.bottom * escala }))
    const [r, g, b] = componentesRGB(colorFondo)
    const canvasPxPorPt = canvas.width / anchoImagen

    let cursor = 0
    let esPrimeraHoja = true
    while (cursor < altoImagen) {
      const propuesto = Math.min(cursor + altoPaginaMax, altoImagen)
      const fin = propuesto >= altoImagen ? altoImagen : corteSeguro(propuesto, zonasProhibidas, cursor)
      const { inicioPx, altoPx } = limitesRecortePx(cursor, fin, canvasPxPorPt, canvas.height)
      const altoHoja = altoPx / canvasPxPorPt
      const altoFisicoHoja = altoHoja + MARGEN_PT * 2

      if (esPrimeraHoja) {
        pdf.internal.pageSize.setHeight(altoFisicoHoja)
      } else {
        // jsPDF reordena el `[ancho, alto]` que se le pase si no "calza" con la orientación
        // activa (documento creado en 'p' — vertical) — con una última hoja más ancha que alta
        // (queda poco contenido real, altoFisicoHoja < anchoPagina) lo interpretaba como al revés
        // y la creaba apaisada con las dimensiones invertidas. Pasar la orientación explícita
        // según corresponda a ESTA hoja puntual evita que jsPDF la reordene por su cuenta.
        pdf.addPage([anchoPagina, altoFisicoHoja], altoFisicoHoja >= anchoPagina ? 'p' : 'l')
      }
      pdf.setFillColor(r, g, b)
      pdf.rect(0, 0, anchoPagina, altoFisicoHoja, 'F')
      pdf.addImage(recortarCanvas(canvas, inicioPx, altoPx), 'PNG', MARGEN_PT, MARGEN_PT, anchoImagen, altoHoja)

      cursor = fin
      esPrimeraHoja = false
    }

    pdf.save(nombreArchivo)
  } finally {
    document.documentElement.classList.remove(CLASE_GENERANDO_PDF)
  }
}
