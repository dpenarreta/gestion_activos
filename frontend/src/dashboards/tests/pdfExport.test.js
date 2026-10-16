import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { generarPDFDesdeElemento } from '../utils/pdfExport'

vi.mock('html2canvas')
vi.mock('jspdf')

// `pdfExport.js` reserva `MARGEN_PT` (24) de margen en los 4 lados — la hoja "fake" mide 48pt más
// en cada dimensión que lo que el código ve como espacio disponible para contenido (600x800), así
// los números de las tarjetas/canvas de cada test (heredados de antes de agregar el margen seguir
// dando 600x800 de "anchoImagen"/"altoPaginaMax" — sin tener que recalcular todo a mano.
const ANCHO_PAGINA_FAKE = 648
const ALTO_PAGINA_FAKE = 848
const MARGEN = 24

function rect(top, bottom, width = 600) {
  return { top, bottom, left: 0, right: width, width, height: bottom - top }
}

function crearContenedorConTarjetas(definiciones) {
  const contenedor = document.createElement('div')
  contenedor.getBoundingClientRect = () => rect(0, 0, 600)
  definiciones.forEach(({ clase, top, bottom }) => {
    const tarjeta = document.createElement('div')
    tarjeta.className = clase
    tarjeta.getBoundingClientRect = () => rect(top, bottom)
    contenedor.appendChild(tarjeta)
  })
  document.body.appendChild(contenedor)
  return contenedor
}

function crearPdfFake() {
  return {
    internal: { pageSize: { getWidth: () => ANCHO_PAGINA_FAKE, getHeight: () => ALTO_PAGINA_FAKE, setHeight: vi.fn() } },
    addPage: vi.fn(),
    addImage: vi.fn(),
    setFillColor: vi.fn(),
    rect: vi.fn(),
    save: vi.fn(),
  }
}

describe('generarPDFDesdeElemento', () => {
  let pdfFake
  let drawImageSpy

  beforeEach(() => {
    pdfFake = crearPdfFake()
    jsPDF.mockImplementation(function jsPDFFake() { return pdfFake })
    // jsdom no implementa el render 2D de <canvas> — se mockean `getContext`/`toDataURL` (usados
    // para recortar, por hoja, la porción del canvas capturado que le corresponde a cada una) para
    // poder probar la lógica de paginación sin depender de un canvas real.
    drawImageSpy = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: drawImageSpy })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,recorte')
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.classList.remove('generando-pdf')
    vi.restoreAllMocks()
  })

  it('agrega la clase generando-pdf mientras captura (para ocultar el chrome de verdad) y la saca al terminar', async () => {
    const contenedor = crearContenedorConTarjetas([{ clase: 'kpi-card', top: 0, bottom: 100 }])
    let claseDuranteCaptura = false
    html2canvas.mockImplementation(async () => {
      claseDuranteCaptura = document.documentElement.classList.contains('generando-pdf')
      return { width: 600, height: 100, toDataURL: () => 'data:image/png;base64,x' }
    })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    expect(claseDuranteCaptura).toBe(true)
    expect(document.documentElement).not.toHaveClass('generando-pdf')
    expect(pdfFake.save).toHaveBeenCalledWith('archivo.pdf')
  })

  it('saca la clase generando-pdf incluso si html2canvas falla', async () => {
    const contenedor = crearContenedorConTarjetas([{ clase: 'kpi-card', top: 0, bottom: 100 }])
    html2canvas.mockRejectedValue(new Error('boom'))

    await expect(generarPDFDesdeElemento(contenedor, 'archivo.pdf')).rejects.toThrow('boom')

    expect(document.documentElement).not.toHaveClass('generando-pdf')
  })

  it('deja un margen parejo en los 4 lados: el contenido no se dibuja pegado al borde de la hoja', async () => {
    const contenedor = crearContenedorConTarjetas([{ clase: 'kpi-card', top: 0, bottom: 100 }])
    html2canvas.mockResolvedValue({ width: 600, height: 100, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    // x=24,y=24 (MARGEN_PT): la imagen arranca adentro de la hoja, no en (0,0).
    expect(pdfFake.addImage.mock.calls[0]).toMatchObject({ 2: MARGEN, 3: MARGEN })
    // La hoja física mide el contenido (100) + el margen de arriba Y de abajo (48) — no solo el
    // contenido a secas, que dejaría el borde inferior pegado al final del texto/tabla.
    expect(pdfFake.internal.pageSize.setHeight).toHaveBeenCalledWith(100 + MARGEN * 2)
  })

  it('no parte una tarjeta a la mitad: retrocede el corte de página hasta su borde superior, sin superponer contenido entre hojas', async () => {
    const contenedor = crearContenedorConTarjetas([
      { clase: 'chart-panel', top: 0, bottom: 700 },
      { clase: 'chart-panel', top: 750, bottom: 950 },
    ])
    html2canvas.mockResolvedValue({ width: 600, height: 1000, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    // Con 800pt de contenido disponible por hoja, el corte "ciego" caería en 800 — DENTRO de la
    // 2da tarjeta (750-950) — así que se retrocede a 750, dejando esa tarjeta entera para la
    // hoja 2. Cada hoja recibe su PROPIO recorte del canvas (antes se reusaba la imagen completa
    // con un offset, y por eso la hoja 2 terminaba mostrando de nuevo lo ya mostrado en la 1).
    expect(pdfFake.internal.pageSize.setHeight).toHaveBeenCalledWith(750 + MARGEN * 2)
    expect(pdfFake.addPage).toHaveBeenCalledWith([ANCHO_PAGINA_FAKE, 250 + MARGEN * 2], 'l')
    expect(pdfFake.addImage).toHaveBeenCalledTimes(2)
    expect(pdfFake.addImage.mock.calls[0]).toMatchObject({ 2: MARGEN, 3: MARGEN, 4: 600, 5: 750 })
    expect(pdfFake.addImage.mock.calls[1]).toMatchObject({ 2: MARGEN, 3: MARGEN, 4: 600, 5: 250 })
    // El recorte de la hoja 1 pide del canvas las filas [0,750) (sx=0, sy=0, sWidth=600,
    // sHeight=750); el de la hoja 2, [750,1000) (sy=750, sHeight=250) — sin superposición ni
    // hueco entre ambos.
    expect(drawImageSpy.mock.calls[0].slice(1, 5)).toEqual([0, 0, 600, 750])
    expect(drawImageSpy.mock.calls[1].slice(1, 5)).toEqual([0, 750, 600, 250])
  })

  it('una tarjeta más alta que una hoja completa se parte igual (única salida posible), sin quedar en un bucle infinito', async () => {
    const contenedor = crearContenedorConTarjetas([{ clase: 'chart-panel', top: 0, bottom: 1200 }])
    html2canvas.mockResolvedValue({ width: 600, height: 1200, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    expect(pdfFake.addPage).toHaveBeenCalledWith([ANCHO_PAGINA_FAKE, 400 + MARGEN * 2], 'l')
    expect(pdfFake.addImage).toHaveBeenCalledTimes(2)
    expect(pdfFake.addImage.mock.calls[0][5]).toBeCloseTo(800)
    expect(pdfFake.addImage.mock.calls[1][5]).toBeCloseTo(400)
  })

  it('una hoja siguiente más alta que ancha pide orientación "p" explícita (no se confía en el default de jsPDF)', async () => {
    const contenedor = crearContenedorConTarjetas([
      { clase: 'kpi-card', top: 0, bottom: 800 },
      { clase: 'kpi-card', top: 800, bottom: 1600 },
    ])
    html2canvas.mockResolvedValue({ width: 600, height: 1600, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    expect(pdfFake.addPage).toHaveBeenCalledWith([ANCHO_PAGINA_FAKE, 800 + MARGEN * 2], 'p')
  })

  it('contenido de exactamente una hoja no agrega una hoja extra casi en blanco', async () => {
    const contenedor = crearContenedorConTarjetas([{ clase: 'kpi-card', top: 0, bottom: 100 }])
    html2canvas.mockResolvedValue({ width: 600, height: 800, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    expect(pdfFake.addPage).not.toHaveBeenCalled()
    expect(pdfFake.addImage).toHaveBeenCalledTimes(1)
    expect(pdfFake.addImage.mock.calls[0][5]).toBeCloseTo(800)
  })

  it('la última hoja no deja un margen enorme: se recorta al contenido real, no al tamaño completo de la hoja', async () => {
    // 3 tarjetas de 400 cada una (total 1200) con 800pt de contenido disponible por hoja —
    // ninguna hoja debería quedar con más contenido declarado que el que realmente le toca.
    const contenedor = crearContenedorConTarjetas([
      { clase: 'kpi-card', top: 0, bottom: 400 },
      { clase: 'kpi-card', top: 400, bottom: 800 },
      { clase: 'kpi-card', top: 800, bottom: 1200 },
    ])
    html2canvas.mockResolvedValue({ width: 600, height: 1200, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    const alturasDeclaradas = pdfFake.addImage.mock.calls.map((llamada) => llamada[5])
    const sumaAlturas = alturasDeclaradas.reduce((a, b) => a + b, 0)
    expect(sumaAlturas).toBeCloseTo(1200)
    alturasDeclaradas.forEach((alto) => expect(alto).toBeLessThanOrEqual(800))
  })

  it('pinta el fondo de cada hoja (incluida la franja del margen) con el color de fondo real', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ backgroundColor: 'rgb(20, 20, 30)' })
    const contenedor = crearContenedorConTarjetas([{ clase: 'kpi-card', top: 0, bottom: 100 }])
    html2canvas.mockResolvedValue({ width: 600, height: 100, toDataURL: () => 'data:image/png;base64,x' })

    await generarPDFDesdeElemento(contenedor, 'archivo.pdf')

    expect(pdfFake.setFillColor).toHaveBeenCalledWith(20, 20, 30)
    // El canvas de este caso mide 100 de alto (más el margen de 48) — no una hoja A4 completa —
    // el fondo se pinta exactamente hasta ahí, evitando el margen en blanco de la última hoja.
    expect(pdfFake.rect).toHaveBeenCalledWith(0, 0, ANCHO_PAGINA_FAKE, 100 + MARGEN * 2, 'F')
  })
})
