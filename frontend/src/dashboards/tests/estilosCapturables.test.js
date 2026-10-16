import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Imprimir como PDF" captura el dashboard con html2canvas (`utils/pdfExport.js`), que reimplementa
 * su propio parser de CSS y NO entiende las funciones de color modernas. Cuando encuentra una,
 * lanza `Attempting to parse an unsupported color function "color"` y la exportación falla entera:
 * el dashboard se ve perfecto en pantalla y el PDF no sale nunca, sin ninguna pista visible.
 *
 * Ya pasó una vez, con `color-mix(in srgb, var(--color-primary) 7%, transparent)` en
 * `.directorio-hallazgos` — Chrome computa esa mezcla como `color(srgb …)`. Esta prueba existe para
 * que la próxima vez se note acá y no en producción.
 *
 * La alternativa es calcular la mezcla por canal, que es lo que ya hace `ThemeContext.jsx`
 * (`oscurecer`/`aclarar`/`hexARgb`), y pedir el color con `rgba(var(--color-primary-rgb), …)`.
 */

// `process.cwd()` y no `import.meta.url`: Vitest sirve los módulos por HTTP, así que
// `import.meta.url` acá no es una ruta de disco. El runner corre desde `frontend/`.
const DIRECTORIO = join(process.cwd(), 'src', 'dashboards', 'styles')
const FUNCIONES_NO_CAPTURABLES = /\b(color-mix|oklch|oklab|lch|lab)\s*\(/

function hojasDeEstilo() {
  return readdirSync(DIRECTORIO).filter((n) => n.endsWith('.css'))
}

// Los comentarios se borran sobre el archivo ENTERO (son multilínea) reemplazando cada carácter
// por un espacio: así el texto explicativo —que nombra `color-mix()` justamente para decir por qué
// no se usa— no cuenta como infracción, pero los números de línea siguen siendo los reales.
function sinComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
}

describe('hojas de estilo propias', () => {
  it('no usan funciones de color que html2canvas no sabe parsear', () => {
    const infractores = []
    for (const nombre of hojasDeEstilo()) {
      const css = readFileSync(join(DIRECTORIO, nombre), 'utf8')
      const lineasOriginales = css.split('\n')
      sinComentarios(css).split('\n').forEach((linea, i) => {
        if (FUNCIONES_NO_CAPTURABLES.test(linea)) {
          infractores.push(`${nombre}:${i + 1} → ${lineasOriginales[i].trim()}`)
        }
      })
    }
    expect(infractores, 'rompen "Imprimir como PDF" (ver el encabezado de este archivo)').toEqual([])
  })

  it('encuentra las hojas de estilo que dice revisar', () => {
    // Sin esto, un cambio de ruta dejaría la prueba de arriba verificando una lista vacía.
    expect(hojasDeEstilo().length).toBeGreaterThan(0)
  })
})


describe('tarjetas de resumen dentro de una sección', () => {
  /**
   * `.directorio-kpi` declara `height: 100%` para que las tarjetas de la fila superior llenen su
   * celda de la rejilla. Dentro de `.directorio-resumen` esa misma regla causaba una
   * superposición: cuando las dos tarjetas no entran lado a lado y la segunda pasa al renglón
   * siguiente, el 100% se resuelve contra el contenedor (una línea de alto) en vez de contra su
   * renglón, el contenedor no crece y la segunda tarjeta se dibuja encima de la tabla.
   *
   * Se vio en producción: los importes del bloque "RESTO (N clientes)" montados sobre las filas
   * del top de clientes, ilegibles.
   */

  it('las tarjetas internas no heredan la altura completa', () => {
    const css = sinComentarios(readFileSync(join(DIRECTORIO, 'directorio.css'), 'utf8'))
    const regla = css.match(/\.directorio-kpi--interno\s*\{([^}]*)\}/)

    expect(regla, 'debería existir la regla .directorio-kpi--interno').not.toBeNull()
    expect(regla[1]).toMatch(/height:\s*auto/)
  })
})


describe('encabezados de las tablas del informe', () => {
  /**
   * Un encabezado que no se puede partir le impone a su columna el ancho del título entero.
   * "% ACUMULADO (CALCULADO)" reservaba 188px y empujaba la tabla de concentración a 501px: en
   * una ventana de 620 no entraba y aparecía desplazamiento lateral por culpa de un título, no
   * de los datos. Partiéndolo, la misma tabla mide 391px y entra completa.
   *
   * No hace falta media query: con espacio, el navegador lo deja en una línea (verificado de
   * 1024 a 1440px); lo parte solo cuando el ancho aprieta.
   */

  it('se pueden partir en dos renglones', () => {
    const css = sinComentarios(readFileSync(join(DIRECTORIO, 'directorio.css'), 'utf8'))
    const regla = css.match(/\.directorio-tabla th\s*\{([^}]*)\}/)

    expect(regla, 'debería existir la regla .directorio-tabla th').not.toBeNull()
    expect(regla[1]).not.toMatch(/white-space:\s*nowrap/)
  })
})

describe('tablas del informe en pantallas angostas', () => {
  /**
   * A 520px de ventana la tabla de concentración medía 377px contra 291px disponibles y aparecía
   * desplazamiento lateral. Se cierra apretando la tabla (menos relleno y un punto menos de letra),
   * NO partiendo los nombres: con `overflow-wrap: anywhere` en la primera columna la tabla entraba
   * exacta, pero la columna quedaba en 46px y "TRANSEXPRESS" se leía "TRA / NSE / XPR / ESS".
   *
   * Entrar en pantalla no sirve de nada si el contenido deja de leerse — de ahí esta guarda.
   */

  const css = () => sinComentarios(readFileSync(join(DIRECTORIO, 'directorio.css'), 'utf8'))

  it('aprietan el relleno de sus celdas', () => {
    const angosto = css().match(/@media \(max-width: 767\.98px\)\s*\{([\s\S]*?)\n\}/)

    expect(angosto, 'debería existir el bloque para pantallas angostas').not.toBeNull()
    expect(angosto[1]).toMatch(/padding-left:\s*[0-4]px/)
  })

  it('no parten los nombres por la mitad para lograrlo', () => {
    expect(css()).not.toMatch(/overflow-wrap:\s*(anywhere|break-word)/)
    expect(css()).not.toMatch(/word-break:\s*break-all/)
  })
})

describe('cortes de ancho del grid de paneles', () => {
  /**
   * Miden el GRID, no la ventana. Entre una y otro hay un menú lateral —que además se pliega— más
   * los rellenos del contenido: a 1100px de ventana el grid mide 917, y con `@media` seguía en el
   * escalón de "pantalla chica", así que los cuatro KPI se acomodaban de a dos y cada tarjeta
   * quedaba de 459px para mostrar un número de seis cifras.
   *
   * Verificado con la ventana fija en 1400px, angostando solo el grid: 1217 → 4 por fila,
   * 700 → 2×2, 420 → apilados.
   */

  const css = () => sinComentarios(readFileSync(join(DIRECTORIO, 'dashboard.css'), 'utf8'))

  it('el grid se declara como contenedor de consulta', () => {
    expect(css()).toMatch(/\.dashboard-grid\s*\{[^}]*container-type:\s*inline-size/)
  })

  it('los escalones de la celda son @container y no @media', () => {
    // Una regla de celda dentro de un @media volvería a medir la ventana.
    for (const bloque of css().matchAll(/@media[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      expect(bloque[1], 'un corte de .dashboard-grid__celda quedó en @media').not.toMatch(
        /\.dashboard-grid__celda/,
      )
    }
    expect(css()).toMatch(/@container[^{]*\{[\s\S]*?\.dashboard-grid__celda/)
  })
})

describe('tarjetas resumen de la concentración de cartera', () => {
  /**
   * Mismo problema que el grid de paneles, un nivel más adentro: los cortes miraban la ventana y
   * el que manda es el ancho del PANEL, que ocupa media rejilla o la rejilla entera según cómo
   * esté armado el dashboard. A 700px de ventana el panel medía 471 y las dos tarjetas se
   * apilaban, cada una de 471px para un importe de siete cifras; a 1100 la tarjeta tenía 423px de
   * sobra y la letra se achicaba igual.
   */

  const css = () => sinComentarios(readFileSync(join(DIRECTORIO, 'directorio.css'), 'utf8'))

  it('la tarjeta se declara como contenedor de consulta', () => {
    const regla = css().match(/\.directorio-kpi--interno\s*\{([^}]*)\}/)

    expect(regla).not.toBeNull()
    expect(regla[1]).toMatch(/container:\s*tarjeta-resumen\s*\/\s*inline-size/)
  })

  it('el tamaño del importe depende de la tarjeta y no de la ventana', () => {
    expect(css()).toMatch(/@container tarjeta-resumen[^{]*\{[\s\S]*?\.directorio-kpi__valor/)
    for (const bloque of css().matchAll(/@media[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      expect(bloque[1], 'el corte del importe volvió a un @media').not.toMatch(
        /\.directorio-kpi--interno/,
      )
    }
  })

  /**
   * Apretar el relleno de la tarjeta cambia el ancho que su propia consulta mide, y una regla que
   * se realimenta así oscila entre dos estados. Por eso el relleno cuelga del PANEL.
   */
  it('el relleno no se aprieta desde la consulta de la propia tarjeta', () => {
    const porTarjeta = css().matchAll(/@container tarjeta-resumen[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/g)
    for (const bloque of porTarjeta) {
      expect(bloque[1], 'el relleno de la tarjeta se decide dentro de su propia consulta')
        .not.toMatch(/padding/)
    }
    expect(css()).toMatch(/@container panel-resumen[^{]*\{[\s\S]*?padding/)
  })
})
